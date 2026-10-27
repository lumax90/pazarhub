import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { z } from 'zod'
import { audit, requireAuth, requirePermission } from './auth'
import type { AppState } from '../src/domain/types'
import type { Database, Sql } from './db'
import type { ServerConfig } from './config'
import { AppError } from './errors'
import { token } from './security'
import { identifier, uuid } from './validation'

export function imageMime(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif'
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp'
  return null
}

export async function storeFile(
  tx: Sql,
  config: ServerConfig,
  input: {
    workspaceId: string
    userId?: string
    name: string
    mime: string
    contents: Buffer
    purpose: 'image' | 'invoice' | 'label' | 'attachment'
  },
) {
  const id = randomUUID(),
    publicToken = token(32),
    name = input.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  await tx.query(
    'INSERT INTO stored_files(id,workspace_id,user_id,name,mime,size,storage_key,public_token,contents,purpose) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      id,
      input.workspaceId,
      input.userId ?? null,
      name,
      input.mime,
      input.contents.length,
      `db:${id}`,
      publicToken,
      input.contents,
      input.purpose,
    ],
  )
  return {
    id,
    url:
      input.purpose === 'attachment'
        ? `/api/files/${id}`
        : `${config.publicOrigin}/media/${publicToken}/${name}`,
    name,
    mime: input.mime,
    size: input.contents.length,
  }
}

export async function registerFileRoutes(
  app: FastifyInstance,
  database: Database,
  config: ServerConfig,
) {
  await app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: 5 * 1024 * 1024 },
  })
  app.post(
    '/api/files/images',
    { bodyLimit: 6 * 1024 * 1024, config: { rateLimit: { max: 40, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const auth = requirePermission(request, 'catalog.write')
      const file = await request.file()
      if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Bir görsel seçin.')
      const data = await file.toBuffer()
      const mime = imageMime(data)
      if (!mime)
        throw new AppError(
          400,
          'INVALID_IMAGE',
          'PNG, JPEG, WebP veya GIF biçiminde bir görsel seçin.',
        )
      const extension = (
        {
          'image/png': 'png',
          'image/jpeg': 'jpg',
          'image/gif': 'gif',
          'image/webp': 'webp',
        } as Record<string, string>
      )[mime]
      const result = await database.transaction(async (tx) => {
        await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [auth.workspaceId])
        const total = (
          await tx.query<{ total: string }>(
            'SELECT COALESCE(sum(size),0)::text AS total FROM stored_files WHERE workspace_id=$1',
            [auth.workspaceId],
          )
        ).rows[0]
        if (Number(total.total) + data.length > 2 * 1024 * 1024 * 1024)
          throw new AppError(413, 'STORAGE_LIMIT', 'Çalışma alanının 2 GB dosya sınırına ulaşıldı.')
        return storeFile(tx, config, {
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          name: `image-${randomUUID()}.${extension}`,
          mime,
          contents: data,
          purpose: 'image',
        })
      })
      return reply.code(201).send(result)
    },
  )
  app.get('/api/files/:id', async (request, reply) => {
    const auth = requireAuth(request),
      id = uuid.parse((request.params as { id: string }).id)
    const file = (
      await database.query<{ name: string; mime: string; contents: Buffer }>(
        'SELECT name,mime,contents FROM stored_files WHERE workspace_id=$1 AND id=$2',
        [auth.workspaceId, id],
      )
    ).rows[0]
    if (!file?.contents) throw new AppError(404, 'NOT_FOUND', 'Dosya bulunamadı.')
    return reply
      .type(file.mime)
      .header('content-disposition', `attachment; filename="${file.name}"`)
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(Buffer.from(file.contents))
  })
  app.post(
    '/api/orders/:id/attachments',
    { bodyLimit: 6 * 1024 * 1024 },
    async (request, reply) => {
      const auth = requirePermission(request, 'orders.write'),
        orderId = identifier.parse((request.params as { id: string }).id)
      const file = await request.file()
      if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Bir dosya seçin.')
      const contents = await file.toBuffer(),
        mime =
          imageMime(contents) ??
          (contents.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : null)
      if (!mime) throw new AppError(400, 'INVALID_FILE', 'PDF, PNG, JPEG, WebP veya GIF yükleyin.')
      const attachment = await database.transaction(async (tx) => {
        const row = (
          await tx.query<{ document: AppState }>(
            'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
            [auth.workspaceId],
          )
        ).rows[0]
        await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [auth.workspaceId])
        const order = row.document.orders.find((order) => order.id === orderId)
        if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sipariş bulunamadı.')
        if ((order.attachments?.length ?? 0) >= 30)
          throw new AppError(422, 'ATTACHMENT_LIMIT', 'Siparişe en fazla 30 ek yüklenebilir.')
        const usage = (
          await tx.query<{ total: string }>(
            'SELECT COALESCE(sum(size),0)::text AS total FROM stored_files WHERE workspace_id=$1',
            [auth.workspaceId],
          )
        ).rows[0]
        if (Number(usage.total) + contents.length > 2 * 1024 * 1024 * 1024)
          throw new AppError(413, 'STORAGE_LIMIT', 'Çalışma alanı dosya sınırına ulaşıldı.')
        const saved = await storeFile(tx, config, {
          workspaceId: auth.workspaceId,
          userId: auth.userId,
          name: file.filename,
          mime,
          contents,
          purpose: 'attachment',
        })
        const attachment = {
          id: saved.id,
          name: file.filename.slice(0, 180),
          size: saved.size,
          mime,
          author: auth.name,
          createdAt: new Date().toISOString(),
        }
        order.attachments = [...(order.attachments ?? []), attachment]
        await tx.query(
          'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
          [JSON.stringify(row.document), auth.workspaceId],
        )
        await audit(tx, auth.workspaceId, auth.userId, 'order.attachment_added', order.id, {
          fileId: saved.id,
        })
        return attachment
      })
      return reply.code(201).send({ attachment })
    },
  )
  app.delete('/api/orders/:id/attachments/:fileId', async (request) => {
    const auth = requirePermission(request, 'orders.write'),
      input = z.object({ id: identifier, fileId: uuid }).parse(request.params)
    return database.transaction(async (tx) => {
      const row = (
        await tx.query<{ document: AppState }>(
          'SELECT document FROM workspace_states WHERE workspace_id=$1 FOR UPDATE',
          [auth.workspaceId],
        )
      ).rows[0]
      const order = row.document.orders.find((order) => order.id === input.id)
      if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Sipariş bulunamadı.')
      if (!order.attachments?.some((file) => file.id === input.fileId)) return { ok: true }
      order.attachments = order.attachments.filter((file) => file.id !== input.fileId)
      await tx.query(
        "DELETE FROM stored_files WHERE workspace_id=$1 AND id=$2 AND purpose='attachment'",
        [auth.workspaceId, input.fileId],
      )
      await tx.query(
        'UPDATE workspace_states SET document=$1,revision=revision+1,updated_at=now() WHERE workspace_id=$2',
        [JSON.stringify(row.document), auth.workspaceId],
      )
      await audit(tx, auth.workspaceId, auth.userId, 'order.attachment_deleted', order.id, {
        fileId: input.fileId,
      })
      return { ok: true }
    })
  })
  app.get(
    '/media/:token/:name',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const input = z
        .object({ token: z.string().regex(/^[\w-]{43}$/), name: z.string().max(140) })
        .parse(request.params)
      const file = (
        await database.query<{ name: string; mime: string; contents: Buffer }>(
          "SELECT name,mime,contents FROM stored_files WHERE public_token=$1 AND purpose<>'attachment'",
          [input.token],
        )
      ).rows[0]
      if (!file?.contents) throw new AppError(404, 'NOT_FOUND', 'Dosya bulunamadı.')
      return reply
        .type(file.mime)
        .header('cache-control', 'private, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "sandbox; default-src 'none'")
        .header('content-disposition', `inline; filename="${file.name}"`)
        .send(Buffer.from(file.contents))
    },
  )
}
