import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../../src/domain/types'
import type { CatalogValueMapping, CategoryMapping } from '../../src/domain/publishing'
import { supportsPublishing, publicationDefinitions } from '../../src/domain/publishing'
import { definitionValues } from '../../src/domain/definitions'
import type { IntegrationService } from '../integration-service'
import { requirePermission, audit } from '../auth'
import { AppError } from '../errors'
import { identifier, uuid } from '../validation'
import { ProviderHttp } from '../integrations/http'
import { publisher } from './registry'
import { CatalogMetadata } from './metadata'
import { attributeSelectionSchema, catalogIdSchema } from './validation'

export function registerValueMappingRoutes(app: FastifyInstance, integrations: IntegrationService) {
  const database = integrations.database
  app.post('/api/catalog-value-mappings', async (request) => {
    const auth = requirePermission(request, 'catalog.write')
    const input = z
      .strictObject({
        id: uuid,
        storeId: uuid,
        version: z.number().int().nonnegative(),
        kind: z.enum(['brand', 'variant', 'attribute']),
        definitionId: identifier,
        categoryId: catalogIdSchema.optional(),
        attributeId: catalogIdSchema.optional(),
        brandId: catalogIdSchema.optional(),
        brandName: z.string().max(300).optional(),
        useSameText: z.boolean().optional(),
        values: z.record(identifier, attributeSelectionSchema),
      })
      .parse(request.body)
    const connection = await integrations.connection(auth.workspaceId, input.storeId)
    if (connection.kind !== 'marketplace' || connection.status !== 'verified')
      throw new AppError(409, 'TEST_REQUIRED', 'Test edilmiş pazaryeri bağlantısı seçin.')
    if (
      !supportsPublishing(connection.provider) ||
      (input.kind === 'brand' &&
        !publicationDefinitions[connection.provider].metadata.includes('brands'))
    )
      throw new AppError(409, 'MAPPING_UNAVAILABLE', 'Bu sağlayıcı bu eşleme türünü desteklemiyor.')
    const state = (
      await database.query<{ document: AppState }>(
        'SELECT document FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0].document
    const definition = state.definitions?.find(
      (item) => item.id === input.definitionId && item.kind === input.kind,
    )
    if (!definition) throw new AppError(404, 'DEFINITION_NOT_FOUND', 'Yerel tanım bulunamadı.')
    const context = {
      workspaceId: auth.workspaceId,
      connectionId: connection.id,
      provider: connection.provider,
      credentials: integrations.credentials(connection),
      settings: connection.settings,
      state,
      integrationName: integrations.config.integrationName,
      hepsiburadaIntegrator: integrations.config.hepsiburadaIntegrator,
    }
    const metadata = new CatalogMetadata(
      database,
      publisher(connection.provider, new ProviderHttp(integrations.fetcher)),
      connection.credential_version,
    )
    const mapping: CatalogValueMapping = {
      id: input.id,
      provider: connection.provider as CatalogValueMapping['provider'],
      version: input.version + 1,
      kind: input.kind,
      definitionId: definition.id,
      values: {},
      updatedAt: new Date().toISOString(),
    }
    if (input.kind === 'brand') {
      await metadata.get(context, { resource: 'brands', query: input.brandName || definition.name })
      const brand = await metadata.findOption(context, { resource: 'brands' }, input.brandId ?? '')
      if (!brand) throw new AppError(422, 'BRAND_REQUIRED', 'Pazaryerinden geçerli marka seçin.')
      mapping.brandId = brand.id
      mapping.brandName = brand.name
    } else {
      if (!input.categoryId || !input.attributeId)
        throw new AppError(422, 'ATTRIBUTE_REQUIRED', 'Pazaryeri kategorisi ve özellik tipi seçin.')
      const schema = (
        await metadata.get(context, { resource: 'attributes', categoryId: input.categoryId })
      ).schema
      const attribute = schema?.attributes.find((item) => item.id === input.attributeId)
      if (!attribute || attribute.personalization)
        throw new AppError(422, 'ATTRIBUTE_REQUIRED', 'Geçerli pazaryeri özellik tipi seçin.')
      if (input.useSameText && !attribute.allowCustom)
        throw new AppError(
          422,
          'CUSTOM_NOT_ALLOWED',
          'Bu özellik aynı metni kabul etmiyor; değer listesinden eşleyin.',
        )
      mapping.categoryId = input.categoryId
      mapping.attributeId = attribute.id
      mapping.attributeName = attribute.name
      mapping.useSameText = !!input.useSameText
      for (const [id, selection] of Object.entries(input.values)) {
        if (!definitionValues(state, definition).some((value) => value.id === id))
          throw new AppError(422, 'VALUE_NOT_FOUND', 'Yerel değer bulunamadı.')
        if (
          (selection.customValue && !attribute.allowCustom) ||
          (!attribute.multiple && (selection.valueIds?.length ?? 0) > 1)
        )
          throw new AppError(
            422,
            'VALUE_INVALID',
            'Özellik değerini sağlayıcı kuralına göre seçin.',
          )
        const labels: string[] = []
        for (const selected of selection.valueIds ?? []) {
          const value = await metadata.findValue(context, input.categoryId, attribute.id, selected)
          if (!value) throw new AppError(422, 'VALUE_INVALID', 'Pazaryeri değeri bulunamadı.')
          labels.push(value.name)
        }
        if (selection.customValue || selection.valueIds?.length)
          mapping.values[id] = { ...selection, labels }
      }
    }
    return database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const current = row.document.definitions?.find((item) => item.id === definition.id)
      if (
        current?.version !== definition.version ||
        JSON.stringify(definitionValues(row.document, current!)) !==
          JSON.stringify(definitionValues(state, definition))
      )
        throw new AppError(
          409,
          'DEFINITION_CHANGED',
          'Yerel tanım değişti. Güncel değerlerle tekrar açın.',
        )
      const currentConnection = await integrations.connection(auth.workspaceId, input.storeId, tx)
      if (
        currentConnection.credential_version !== connection.credential_version ||
        currentConnection.status !== 'verified'
      )
        throw new AppError(409, 'CONNECTION_CHANGED', 'Mağaza bağlantısı değişti.')
      const old = row.document.catalogValueMappings?.find((item) => item.id === input.id)
      if ((old?.version ?? 0) !== input.version)
        throw new AppError(409, 'MAPPING_CHANGED', 'Eşleme değişti. Güncel kaydı açın.')
      if (
        row.document.catalogValueMappings?.some(
          (item) =>
            item.id !== input.id &&
            item.provider === mapping.provider &&
            item.kind === mapping.kind &&
            item.definitionId === mapping.definitionId &&
            item.categoryId === mapping.categoryId,
        )
      )
        throw new AppError(409, 'MAPPING_EXISTS', 'Bu tanım için eşleme zaten var.')
      row.document.catalogValueMappings = (row.document.catalogValueMappings ?? [])
        .filter((item) => item.id !== mapping.id)
        .concat(mapping)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'catalog.value_mapping_saved', mapping.id, {
        provider: mapping.provider,
      })
      return { ok: true }
    })
  })
  app.post('/api/catalog-mappings/delete', async (request) => {
    const auth = requirePermission(request, 'catalog.write')
    const input = z
      .strictObject({
        id: uuid,
        version: z.number().int().nonnegative(),
        kind: z.enum(['category', 'value']),
      })
      .parse(request.body)
    return database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const key = input.kind === 'category' ? 'categoryMappings' : 'catalogValueMappings'
      const mappings: (CategoryMapping | CatalogValueMapping)[] = row.document[key] ?? []
      const old = mappings.find((item) => item.id === input.id)
      if (!old || old.version !== input.version)
        throw new AppError(409, 'MAPPING_CHANGED', 'Eşleme değişti veya bulunamadı.')
      if (input.kind === 'category')
        row.document.categoryMappings = row.document.categoryMappings?.filter(
          (item) => item.id !== input.id,
        )
      else
        row.document.catalogValueMappings = row.document.catalogValueMappings?.filter(
          (item) => item.id !== input.id,
        )
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'catalog.mapping_deleted', input.id, {
        kind: input.kind,
      })
      return { ok: true }
    })
  })
}
