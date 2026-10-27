import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { createEmptyState } from '../src/domain/empty-state'
import { rolePermissions } from '../src/domain/permissions'
import type { Permission, Role } from '../src/domain/permissions'
import type { ServerConfig } from './config'
import type { Database, Sql } from './db'
import type { AuthContext } from './auth-types'
import { AppError } from './errors'
import { hashPassword, sha256, token, verifyPassword } from './security'
import { loginSchema, passwordSchema, registrationSchema, uuid } from './validation'
import { sendPasswordReset } from './mail'

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError(401, 'AUTH_REQUIRED', 'Devam etmek için giriş yapın.')
  return request.auth
}
export function requirePermission(request: FastifyRequest, permission: Permission) {
  const auth = requireAuth(request)
  if (!auth.permissions.includes(permission))
    throw new AppError(403, 'FORBIDDEN', 'Bu işlem için yetkiniz bulunmuyor.')
  return auth
}
export function assertPermission(auth: AuthContext, permission: Permission) {
  if (!auth.permissions.includes(permission))
    throw new AppError(403, 'FORBIDDEN', 'Bu işlem için yetkiniz bulunmuyor.')
}

export async function audit(
  tx: Sql,
  workspaceId: string,
  userId: string | null,
  action: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.query(
    'INSERT INTO audit_events(id,workspace_id,user_id,action,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [randomUUID(), workspaceId, userId, action, entityId ?? null, JSON.stringify(metadata)],
  )
}

async function createSession(
  database: Database,
  config: ServerConfig,
  userId: string,
  workspaceId: string,
  reply: FastifyReply,
) {
  const raw = token()
  const csrfToken = token()
  await database.query(
    'INSERT INTO sessions(token_hash,user_id,workspace_id,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5)',
    [
      sha256(raw),
      userId,
      workspaceId,
      csrfToken,
      new Date(Date.now() + config.sessionHours * 3600000),
    ],
  )
  reply.setCookie(config.cookieName, raw, {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    maxAge: config.sessionHours * 3600,
  })
  return csrfToken
}

export function registerAuth(app: FastifyInstance, database: Database, config: ServerConfig) {
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/') || request.url === '/api/health') return
    const raw = request.cookies[config.cookieName]
    if (!raw || raw.length > 200) return
    const requestedWorkspace = request.headers['x-workspace-id']
      ? uuid.parse(request.headers['x-workspace-id'])
      : null
    const { rows } = await database.query<{
      user_id: string
      workspace_id: string
      email: string
      name: string
      avatar_seed: string | null
      workspace_name: string
      role: Role
      csrf_token: string
      preferences: AuthContext['preferences']
    }>(
      `
      SELECT u.id AS user_id,w.id AS workspace_id,u.email,u.name,u.avatar_seed,w.name AS workspace_name,m.role,s.csrf_token,m.preferences
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.id=COALESCE($2::uuid,s.workspace_id)
      JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=w.id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
      [sha256(raw), requestedWorkspace],
    )
    const row = rows[0]
    if (row)
      request.auth = {
        userId: row.user_id,
        workspaceId: row.workspace_id,
        email: row.email,
        name: row.name,
        avatarSeed: row.avatar_seed,
        workspaceName: row.workspace_name,
        role: row.role,
        permissions: rolePermissions[row.role],
        csrfToken: row.csrf_token,
        sessionHash: sha256(raw),
        preferences: row.preferences,
      }
  })
  app.addHook('preHandler', async (request) => {
    if (!request.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method))
      return
    if (request.headers.origin !== config.publicOrigin)
      throw new AppError(403, 'ORIGIN_REJECTED', 'İstek kaynağı doğrulanamadı.')
    if (request.auth && request.headers['x-csrf-token'] !== request.auth.csrfToken)
      throw new AppError(403, 'CSRF_REJECTED', 'Oturum doğrulaması yenilenmeli. Sayfayı yenileyin.')
  })

  app.get('/api/session', async (request) => {
    if (!request.auth) return { user: null, registrationEnabled: config.registrationEnabled }
    const auth = request.auth
    const { rows } = await database.query<{ id: string; name: string; role: Role }>(
      'SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY w.created_at',
      [auth.userId],
    )
    return {
      user: {
        id: auth.userId,
        name: auth.name,
        email: auth.email,
        avatarSeed: auth.avatarSeed,
        role: auth.role,
        permissions: auth.permissions,
      },
      workspace: { id: auth.workspaceId, name: auth.workspaceName },
      workspaces: rows,
      csrfToken: auth.csrfToken,
      registrationEnabled: config.registrationEnabled,
    }
  })

  app.post(
    '/api/auth/forgot-password',
    { config: { rateLimit: { max: 4, timeWindow: '15 minutes' } } },
    async (request) => {
      const { email } = z
        .strictObject({
          email: z
            .string()
            .email()
            .max(254)
            .transform((value) => value.toLowerCase().trim()),
        })
        .parse(request.body)
      if (!config.smtp)
        throw new AppError(
          503,
          'EMAIL_NOT_CONFIGURED',
          'Parola yenileme için sunucuda SMTP ayarı yapılmalı. Çalışma alanı yöneticinizle iletişime geçin.',
        )
      const user = (
        await database.query<{ id: string }>(
          'SELECT id FROM users WHERE email=$1 AND active=true',
          [email],
        )
      ).rows[0]
      if (user) {
        const raw = token()
        await database.query(
          `INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES($1,$2,'password_reset',now()+interval '1 hour')`,
          [sha256(raw), user.id],
        )
        await sendPasswordReset(
          config,
          email,
          `${config.publicOrigin}/?reset=${encodeURIComponent(raw)}`,
        )
      }
      return {
        ok: true,
        message: 'Hesap mevcutsa parola yenileme bağlantısı e-posta adresinize gönderildi.',
      }
    },
  )
  app.post(
    '/api/auth/reset-password',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (request) => {
      const input = z
        .strictObject({ token: z.string().min(20).max(200), password: passwordSchema })
        .parse(request.body)
      const password = await hashPassword(input.password)
      await database.transaction(async (tx) => {
        const reset = (
          await tx.query<{ user_id: string }>(
            `SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
            [sha256(input.token)],
          )
        ).rows[0]
        if (!reset)
          throw new AppError(
            400,
            'INVALID_RESET',
            'Parola yenileme bağlantısı geçersiz veya süresi dolmuş.',
          )
        await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [password, reset.user_id])
        await tx.query(
          `UPDATE auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose='password_reset'`,
          [reset.user_id],
        )
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [reset.user_id])
      })
      return { ok: true }
    },
  )
  app.get(
    '/api/invitations/preview',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request) => {
      const raw = z
        .string()
        .min(20)
        .max(200)
        .parse((request.query as { token?: string }).token)
      const invitation = (
        await database.query<{ name: string; email: string; role: Role }>(
          `SELECT w.name,i.email,i.role FROM invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now()`,
          [sha256(raw)],
        )
      ).rows[0]
      if (!invitation)
        throw new AppError(400, 'INVALID_INVITATION', 'Davet geçersiz veya süresi dolmuş.')
      return invitation
    },
  )

  app.post(
    '/api/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      if (!config.registrationEnabled)
        throw new AppError(
          403,
          'REGISTRATION_DISABLED',
          'Yeni kayıt şu anda kapalı. Davet bağlantınızı kullanın.',
        )
      const input = registrationSchema.parse(request.body)
      const password = await hashPassword(input.password)
      const userId = randomUUID(),
        workspaceId = randomUUID()
      await database.transaction(async (tx) => {
        const existing = await tx.query('SELECT id FROM users WHERE email=$1', [input.email])
        if (existing.rows.length)
          throw new AppError(
            409,
            'EMAIL_EXISTS',
            'Bu e-posta adresiyle bir hesap var. Giriş yapın.',
          )
        await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
          userId,
          input.email,
          input.name,
          password,
        ])
        await tx.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [
          workspaceId,
          input.workspaceName,
        ])
        await tx.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)', [
          workspaceId,
          userId,
          'owner',
        ])
        await tx.query('INSERT INTO workspace_states(workspace_id,document) VALUES($1,$2)', [
          workspaceId,
          JSON.stringify(createEmptyState(input.workspaceName)),
        ])
        await audit(tx, workspaceId, userId, 'workspace.created', workspaceId)
      })
      const csrfToken = await createSession(database, config, userId, workspaceId, reply)
      return reply.code(201).send({ ok: true, csrfToken })
    },
  )

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 12, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body)
      const { rows } = await database.query<{
        id: string
        password_hash: string
        active: boolean
        workspace_id: string
      }>(
        `SELECT u.id,u.password_hash,u.active,m.workspace_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 ORDER BY m.workspace_id LIMIT 1`,
        [input.email],
      )
      const user = rows[0]
      const dummy =
        'scrypt-v1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      const matches = await verifyPassword(input.password, user?.password_hash ?? dummy)
      if (!user?.active || !matches)
        throw new AppError(401, 'INVALID_LOGIN', 'E-posta veya parola hatalı.')
      if (request.auth)
        await database.query('DELETE FROM sessions WHERE token_hash=$1', [request.auth.sessionHash])
      const csrfToken = await createSession(database, config, user.id, user.workspace_id, reply)
      await audit(database, user.workspace_id, user.id, 'auth.login')
      return { ok: true, csrfToken }
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.auth)
      await database.query('DELETE FROM sessions WHERE token_hash=$1', [request.auth.sessionHash])
    reply.clearCookie(config.cookieName, {
      path: '/',
      secure: config.secureCookies,
      httpOnly: true,
      sameSite: 'lax',
    })
    return { ok: true }
  })

  app.post('/api/auth/password', async (request) => {
    const auth = requireAuth(request)
    const input = z
      .strictObject({
        currentPassword: z.string().max(128),
        newPassword: passwordSchema,
      })
      .parse(request.body)
    const user = (
      await database.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id=$1',
        [auth.userId],
      )
    ).rows[0]
    if (!user || !(await verifyPassword(input.currentPassword, user.password_hash)))
      throw new AppError(400, 'INVALID_PASSWORD', 'Mevcut parola doğrulanamadı.')
    const password = await hashPassword(input.newPassword)
    await database.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2', [password, auth.userId])
      await tx.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [
        auth.userId,
        auth.sessionHash,
      ])
      await audit(tx, auth.workspaceId, auth.userId, 'auth.password_changed')
    })
    return { ok: true }
  })

  app.patch('/api/auth/profile', async (request) => {
    const auth = requireAuth(request)
    const input = z
      .strictObject({
        name: z.string().trim().min(2).max(160),
        avatarSeed: z.string().trim().min(1).max(80).nullable(),
      })
      .parse(request.body)
    await database.transaction(async (tx) => {
      await tx.query('UPDATE users SET name=$1,avatar_seed=$2 WHERE id=$3', [
        input.name,
        input.avatarSeed,
        auth.userId,
      ])
      await audit(tx, auth.workspaceId, auth.userId, 'auth.profile_updated')
    })
    return { ok: true }
  })

  app.post('/api/workspaces/switch', async (request) => {
    const auth = requireAuth(request)
    const { workspaceId } = z.strictObject({ workspaceId: uuid }).parse(request.body)
    const membership = await database.query(
      'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',
      [workspaceId, auth.userId],
    )
    if (!membership.rows.length)
      throw new AppError(403, 'FORBIDDEN', 'Bu çalışma alanına erişiminiz yok.')
    await database.query('UPDATE sessions SET workspace_id=$1 WHERE token_hash=$2', [
      workspaceId,
      auth.sessionHash,
    ])
    return { ok: true }
  })

  app.get('/api/team', async (request) => {
    const auth = requirePermission(request, 'team.manage')
    const members = await database.query(
      'SELECT u.id,u.name,u.email,u.active,m.role,u.created_at FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.created_at',
      [auth.workspaceId],
    )
    const invitations = await database.query(
      'SELECT id,email,role,expires_at,created_at FROM invitations WHERE workspace_id=$1 AND accepted_at IS NULL AND expires_at>now()',
      [auth.workspaceId],
    )
    return { members: members.rows, invitations: invitations.rows }
  })

  app.post('/api/team/invitations', async (request) => {
    const auth = requirePermission(request, 'team.manage')
    const input = z
      .strictObject({
        email: z
          .string()
          .email()
          .max(254)
          .transform((value) => value.toLowerCase()),
        role: z.enum(['manager', 'operator', 'accountant', 'viewer']),
      })
      .parse(request.body)
    if (auth.role !== 'owner' && input.role === 'manager')
      throw new AppError(403, 'ROLE_ESCALATION', 'Yönetici davetini kurucu oluşturabilir.')
    const raw = token(),
      id = randomUUID()
    await database.query(
      'INSERT INTO invitations(id,workspace_id,email,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        auth.workspaceId,
        input.email,
        input.role,
        sha256(raw),
        auth.userId,
        new Date(Date.now() + 86400000),
      ],
    )
    await audit(database, auth.workspaceId, auth.userId, 'team.invited', id, { role: input.role })
    return {
      id,
      url: `${config.publicOrigin}/?invite=${encodeURIComponent(raw)}`,
      expiresInHours: 24,
    }
  })

  app.post('/api/auth/accept-invitation', async (request, reply) => {
    const input = z
      .strictObject({
        token: z.string().min(20).max(200),
        name: z.string().trim().min(2).max(160),
        password: passwordSchema.optional(),
      })
      .parse(request.body)
    const passwordHash = input.password ? await hashPassword(input.password) : undefined
    const result = await database.transaction(async (tx) => {
      const invitation = (
        await tx.query<{ id: string; workspace_id: string; email: string; role: Role }>(
          'SELECT id,workspace_id,email,role FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',
          [sha256(input.token)],
        )
      ).rows[0]
      if (!invitation)
        throw new AppError(400, 'INVALID_INVITATION', 'Davet geçersiz veya süresi dolmuş.')
      const existing = (
        await tx.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [invitation.email])
      ).rows[0]
      if (existing && request.auth?.userId !== existing.id)
        throw new AppError(
          409,
          'LOGIN_REQUIRED',
          'Davet bu e-postadaki mevcut hesaba ait. Önce o hesapla giriş yapın.',
        )
      if (!existing && !passwordHash)
        throw new AppError(400, 'PASSWORD_REQUIRED', 'Yeni hesabınız için bir parola belirleyin.')
      const userId = existing?.id ?? randomUUID()
      if (!existing)
        await tx.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [
          userId,
          invitation.email,
          input.name,
          passwordHash,
        ])
      await tx.query(
        'INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [invitation.workspace_id, userId, invitation.role],
      )
      await tx.query('UPDATE invitations SET accepted_at=now() WHERE id=$1', [invitation.id])
      await audit(tx, invitation.workspace_id, userId, 'team.invitation_accepted', invitation.id)
      return { userId, workspaceId: invitation.workspace_id }
    })
    const csrfToken = await createSession(
      database,
      config,
      result.userId,
      result.workspaceId,
      reply,
    )
    return { ok: true, csrfToken }
  })

  app.patch('/api/team/:userId', async (request) => {
    const auth = requirePermission(request, 'team.manage')
    const target = uuid.parse((request.params as { userId: string }).userId)
    const { role } = z
      .strictObject({ role: z.enum(['manager', 'operator', 'accountant', 'viewer']) })
      .parse(request.body)
    await database.transaction(async (tx) => {
      await tx.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [auth.workspaceId])
      const membership = (
        await tx.query<{ role: Role }>(
          'SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2',
          [auth.workspaceId, target],
        )
      ).rows[0]
      if (!membership) throw new AppError(404, 'NOT_FOUND', 'Kullanıcı bulunamadı.')
      if (membership.role === 'owner' || target === auth.userId)
        throw new AppError(
          403,
          'OWNER_PROTECTED',
          'Kurucu veya kendi rolünüz bu işlemle değiştirilemez.',
        )
      if (auth.role !== 'owner' && (role === 'manager' || membership.role === 'manager'))
        throw new AppError(403, 'ROLE_ESCALATION', 'Yönetici rollerini kurucu düzenleyebilir.')
      await tx.query('UPDATE memberships SET role=$1 WHERE workspace_id=$2 AND user_id=$3', [
        role,
        auth.workspaceId,
        target,
      ])
      await audit(tx, auth.workspaceId, auth.userId, 'team.role_changed', target, { role })
    })
    return { ok: true }
  })
}
