import type { FastifyInstance } from 'fastify'
import type { IntegrationService } from '../integration-service'
import { requirePermission, audit } from '../auth'
import { uuid } from '../validation'
import { AppError } from '../errors'
import { externalRecord } from './service'
import { imageMime, storeFile } from '../files'
import { claimDecisionOptions } from './claim-options'
import { ProviderHttp } from '../integrations/http'

export function registerClaimDocuments(app: FastifyInstance, service: IntegrationService) {
  const db = service.database
  app.get('/api/marketplace/claims/:id/options', async (request) => {
    const auth = requirePermission(request, 'finance.write'),
      id = uuid.parse((request.params as { id: string }).id),
      record = await externalRecord(db, auth.workspaceId, id)
    if (record.resource !== 'claim') throw new AppError(400, 'CLAIM_REQUIRED', 'İade kaydı seçin.')
    const connection = await service.connection(auth.workspaceId, record.connection_id),
      state = (
        await db.query<{ document: import('../../src/domain/types').AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1',
          [auth.workspaceId],
        )
      ).rows[0].document
    const options = await claimDecisionOptions(
      {
        workspaceId: auth.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        credentials: service.credentials(connection),
        settings: connection.settings,
        integrationName: service.config.integrationName,
        state,
      },
      new ProviderHttp(service.fetcher),
    )
    const files = await db.query<{ id: string; name: string; mime: string; size: number }>(
      'SELECT f.id,f.name,f.mime,f.size FROM claim_documents d JOIN stored_files f ON f.workspace_id=d.workspace_id AND f.id=d.file_id WHERE d.workspace_id=$1 AND d.record_id=$2 ORDER BY f.created_at',
      [auth.workspaceId, id],
    )
    return { ...options, files: files.rows }
  })
  app.post(
    '/api/marketplace/claims/:id/files',
    { bodyLimit: 6 * 1024 * 1024 },
    async (request, reply) => {
      const auth = requirePermission(request, 'finance.write'),
        id = uuid.parse((request.params as { id: string }).id),
        file = await request.file()
      if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Bir kanıt dosyası seçin.')
      const contents = await file.toBuffer(),
        mime =
          imageMime(contents) ??
          (contents.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null)
      if (!mime || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime))
        throw new AppError(422, 'INVALID_FILE', 'PDF, PNG, JPEG veya WebP yükleyin.')
      const result = await db.transaction(async (tx) => {
        await tx.query(
          'SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
        const claim = await externalRecord(tx, auth.workspaceId, id, true)
        if (claim.resource !== 'claim')
          throw new AppError(400, 'CLAIM_REQUIRED', 'İade kaydı seçin.')
        const existing = await tx.query<{ id: string; name: string; mime: string; size: number }>(
          'SELECT f.id,f.name,f.mime,f.size FROM claim_documents d JOIN stored_files f ON f.id=d.file_id AND f.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.record_id=$2 AND f.contents=$3',
          [auth.workspaceId, id, contents],
        )
        if (existing.rows[0]) return existing.rows[0]
        const count = await tx.query(
          'SELECT file_id FROM claim_documents WHERE workspace_id=$1 AND record_id=$2',
          [auth.workspaceId, id],
        )
        if (count.rows.length >= 3)
          throw new AppError(
            422,
            'CLAIM_FILE_LIMIT',
            'Bir talebe en fazla üç dosya ekleyebilirsiniz.',
          )
        const usage = (
          await tx.query<{ total: string }>(
            'SELECT COALESCE(sum(size),0)::text AS total FROM stored_files WHERE workspace_id=$1',
            [auth.workspaceId],
          )
        ).rows[0]
        if (Number(usage.total) + contents.length > 2 * 1024 * 1024 * 1024)
          throw new AppError(413, 'STORAGE_LIMIT', 'Çalışma alanı dosya sınırına ulaşıldı.')
        const saved = await storeFile(tx, service.config, {
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          name: file.filename,
          mime,
          contents,
          purpose: 'attachment',
        })
        await tx.query(
          'INSERT INTO claim_documents(workspace_id,record_id,file_id) VALUES($1,$2,$3)',
          [auth.workspaceId, id, saved.id],
        )
        await audit(tx, auth.workspaceId, auth.userId, 'claim.evidence_uploaded', id, {
          fileId: saved.id,
        })
        return { id: saved.id, name: file.filename, mime, size: contents.length }
      })
      return reply.code(201).send({ file: result })
    },
  )
  app.delete('/api/marketplace/claims/:id/files/:fileId', async (request) => {
    const auth = requirePermission(request, 'finance.write'),
      params = request.params as { id: string; fileId: string },
      id = uuid.parse(params.id),
      fileId = uuid.parse(params.fileId)
    return db.transaction(async (tx) => {
      await tx.query('SELECT workspace_id FROM workspace_states WHERE workspace_id=$1 FOR UPDATE', [
        auth.workspaceId,
      ])
      await externalRecord(tx, auth.workspaceId, id, true)
      const used = await tx.query(
        "SELECT id FROM integration_jobs WHERE workspace_id=$1 AND entity_id=$2 AND payload->'fileIds' ? $3 LIMIT 1",
        [auth.workspaceId, id, fileId],
      )
      if (used.rows.length)
        throw new AppError(
          409,
          'EVIDENCE_USED',
          'Karara eklenmiş kanıt dosyası işlem geçmişinde korunur.',
        )
      const removed = await tx.query(
        'DELETE FROM claim_documents WHERE workspace_id=$1 AND record_id=$2 AND file_id=$3 RETURNING file_id',
        [auth.workspaceId, id, fileId],
      )
      if (removed.rows.length)
        await tx.query('DELETE FROM stored_files WHERE workspace_id=$1 AND id=$2', [
          auth.workspaceId,
          fileId,
        ])
      return { ok: true }
    })
  })
}
