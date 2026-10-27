import type { FastifyInstance } from 'fastify'
import type { Database } from './db'
import { audit, requirePermission } from './auth'
import { AppError } from './errors'
import { uuid } from './validation'

export function registerTeamRoutes(app: FastifyInstance, database: Database) {
  app.delete('/api/team/:userId', async (request) => {
    const auth = requirePermission(request, 'team.manage'),
      userId = uuid.parse((request.params as { userId: string }).userId)
    await database.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [auth.workspaceId])
      const target = (
        await tx.query<{ role: string }>(
          'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',
          [auth.workspaceId, userId],
        )
      ).rows[0]
      if (!target) throw new AppError(404, 'NOT_FOUND', 'Kullanıcı bulunamadı.')
      if (
        target.role === 'owner' ||
        userId === auth.userId ||
        (target.role === 'manager' && auth.role !== 'owner')
      )
        throw new AppError(
          403,
          'ROLE_PROTECTED',
          'Bu kullanıcının erişimini kaldırma yetkiniz yok.',
        )
      await tx.query('DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2', [
        auth.workspaceId,
        userId,
      ])
      await tx.query('DELETE FROM sessions WHERE workspace_id=$1 AND user_id=$2', [
        auth.workspaceId,
        userId,
      ])
      await audit(tx, auth.workspaceId, auth.userId, 'team.member_removed', userId)
    })
    return { ok: true }
  })
  app.delete('/api/team/invitations/:id', async (request) => {
    const auth = requirePermission(request, 'team.manage'),
      id = uuid.parse((request.params as { id: string }).id)
    const result = await database.query(
      'DELETE FROM invitations WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL RETURNING id',
      [auth.workspaceId, id],
    )
    if (!result.rows.length) throw new AppError(404, 'NOT_FOUND', 'Bekleyen davet bulunamadı.')
    await audit(database, auth.workspaceId, auth.userId, 'team.invitation_revoked', id)
    return { ok: true }
  })
}
