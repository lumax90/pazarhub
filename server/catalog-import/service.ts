import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppState } from '../../src/domain/types'
import type { IntegrationService } from '../integration-service'
import { audit, assertPermission, requirePermission } from '../auth'
import { AppError } from '../errors'
import { uuid } from '../validation'
import { enqueue } from '../jobs'
import { parseImport, suggestMapping } from './parsing'
import type { ImportData } from './parsing'
import { applyImportPlan, optionsSchema, planImport } from './planning'
import type { ImportPlan } from './planning'

interface ImportSource {
  name: string
  document: ImportData
  plan: ImportPlan | null
  applied_at: string | null
  result: { ok: true; count: number } | null
}
export function registerCatalogImportRoutes(app: FastifyInstance, service: IntegrationService) {
  const db = service.database
  app.post(
    '/api/catalog-imports',
    { bodyLimit: 3 * 1024 * 1024, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = requirePermission(request, 'catalog.write'),
        input = z
          .strictObject({
            name: z.string().min(1).max(160),
            format: z.enum(['csv', 'xml']),
            text: z
              .string()
              .min(1)
              .max(2 * 1024 * 1024),
            recordPath: z.string().max(300).optional(),
          })
          .parse(request.body)
      const data = parseImport(input.text, input.format, input.recordPath),
        id = randomUUID()
      await db.query(
        `INSERT INTO catalog_imports(id,workspace_id,user_id,name,document,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour')`,
        [id, auth.workspaceId, auth.userId, input.name, JSON.stringify(data)],
      )
      return reply.code(201).send({
        id,
        name: input.name,
        format: input.format,
        columns: data.columns,
        count: data.rows.length,
        samples: data.rows.slice(0, 4),
        recordPath: data.recordPath,
        recordPaths: data.recordPaths,
        suggested: suggestMapping(data.columns),
      })
    },
  )
  app.post('/api/catalog-imports/:id/preview', async (request) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = uuid.parse((request.params as { id: string }).id),
      options = optionsSchema.parse(request.body)
    if (options.mapping.stock) assertPermission(auth, 'stock.write')
    const source = (
      await db.query<ImportSource>(
        'SELECT * FROM catalog_imports WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND expires_at>now()',
        [id, auth.workspaceId, auth.userId],
      )
    ).rows[0]
    if (!source || source.applied_at)
      throw new AppError(
        409,
        'IMPORT_EXPIRED',
        'Dosyayı yeniden seçin; içe aktarma süresi doldu veya tamamlandı.',
      )
    const state = (
      await db.query<{ document: AppState; revision: string | number }>(
        'SELECT document,revision FROM workspace_states WHERE workspace_id=$1',
        [auth.workspaceId],
      )
    ).rows[0]
    const plan = planImport(
      state.document,
      Number(state.revision),
      source.document,
      options,
      id,
      source.name,
    )
    const updated = await db.query(
      'UPDATE catalog_imports SET plan=$1 WHERE id=$2 AND workspace_id=$3 AND applied_at IS NULL RETURNING id',
      [JSON.stringify(plan), id, auth.workspaceId],
    )
    if (!updated.rows.length)
      throw new AppError(409, 'IMPORT_CHANGED', 'İçe aktarma durumu değişti.')
    return plan.preview
  })
  app.post('/api/catalog-imports/:id/apply', async (request) => {
    const auth = requirePermission(request, 'catalog.write'),
      id = uuid.parse((request.params as { id: string }).id),
      { previewId } = z.strictObject({ previewId: uuid }).parse(request.body)
    return db.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState; revision: string | number }>(
          'SELECT document,revision FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const source = (
        await tx.query<ImportSource>(
          'SELECT * FROM catalog_imports WHERE id=$1 AND workspace_id=$2 AND user_id=$3 FOR UPDATE',
          [id, auth.workspaceId, auth.userId],
        )
      ).rows[0]
      if (!source) throw new AppError(404, 'IMPORT_NOT_FOUND', 'İçe aktarma bulunamadı.')
      if (source.applied_at) return source.result!
      const plan = source.plan
      if (
        !plan ||
        plan.id !== previewId ||
        new Date(plan.preview.expiresAt).getTime() <= Date.now()
      )
        throw new AppError(409, 'PREVIEW_EXPIRED', 'İçe aktarma önizlemesini yenileyin.')
      if (plan.stock.length) assertPermission(auth, 'stock.write')
      if (plan.preview.errors.length)
        throw new AppError(422, 'IMPORT_HAS_ERRORS', 'Önce dosyadaki hataları düzeltin.')
      if (Number(row.revision) !== plan.revision)
        throw new AppError(
          409,
          'IMPORT_STALE',
          'Önizlemeden sonra çalışma alanı değişti. Güncel verilerle tekrar önizleyin.',
        )
      const state = applyImportPlan(row.document, plan, source.name)
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(state), auth.workspaceId],
      )
      const result = { ok: true as const, count: plan.preview.variantCount }
      await tx.query(
        `UPDATE catalog_imports SET applied_at=now(),result=$1,document='{}'::jsonb,plan=NULL WHERE id=$2`,
        [JSON.stringify(result), id],
      )
      const connections = await tx.query<{ id: string }>(
        `SELECT id FROM integration_connections WHERE workspace_id=$1 AND enabled=true AND status='verified' AND deleted_at IS NULL AND settings->>'pushInventory'='true'`,
        [auth.workspaceId],
      )
      for (const connection of connections.rows)
        await enqueue(tx, {
          workspaceId: auth.workspaceId,
          connectionId: connection.id,
          kind: 'inventory.reconcile',
          key: `import:${id}:${connection.id}`,
        })
      await audit(tx, auth.workspaceId, auth.userId, 'catalog.imported', id, {
        name: source.name,
        variants: result.count,
        newProducts: plan.preview.newProducts,
        updatedProducts: plan.preview.updatedProducts,
        stockChanges: plan.stock.length,
      })
      return result
    })
  })
}
