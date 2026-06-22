const crypto = require('node:crypto')
const express = require('express')
const cookieParser = require('cookie-parser')
const { createWebConsoleRepository } = require('./repository.ts') as {
  createWebConsoleRepository(options?: any): import('./types.ts').WebConsoleRepository
}
const { createMockNocoClient } = require('./mock-data.ts') as {
  createMockNocoClient(): any
}
const {
  createDefaultDolphinLeaseService,
  normalizeDolphinErrorDetails,
  resolveDolphinSharedUserEmail,
  resolveDolphinSharedUserId
} = require('./dolphin-lease.ts') as {
  createDefaultDolphinLeaseService(): DolphinLeaseService
  normalizeDolphinErrorDetails(error: unknown): any
  resolveDolphinSharedUserEmail(): string
  resolveDolphinSharedUserId(): number
}
const { createDefaultVerificationCodeService } = require('./dolphin-verification-code.ts') as {
  createDefaultVerificationCodeService(): VerificationCodeService
}
const {
  createDolphinProfileProvisioner,
  prepareJudosharkClientIfNeeded
} = require('./dolphin-profile-provisioning.ts') as {
  createDolphinProfileProvisioner(options: {
    repository: WebConsoleRepository
    api?: any
    templateProfileId?: number
  }): DolphinProfileProvisioner
  prepareJudosharkClientIfNeeded(repository: WebConsoleRepository, client: any): Promise<any>
}

type Request = import('express').Request
type Response = import('express').Response
type NextFunction = import('express').NextFunction
type WebConsoleRepository = import('./types.ts').WebConsoleRepository
type WebSession = import('./types.ts').WebSession
type UserRole = import('./types.ts').UserRole
type DolphinLeaseService = {
  acquire(request: {
    ownerKey: string
    ownerLabel: string
    role: 'client' | 'provider' | 'admin'
    targetClientId: number
    targetClientName: string
    username: string
    password: string
    sourceEmail?: string
    profileIds: number[]
    knownProfileIds: number[]
  }): Promise<unknown>
}
type DolphinProfileProvisioner = {
  ensureClientProfiles(request: {
    client: any
    existingProfiles: Array<{ id: number; locale: string }>
    actorRole: 'client' | 'admin'
  }): Promise<unknown>
}
type VerificationCodeService = {
  getLatestCode(): Promise<unknown>
}

const SESSION_COOKIE = 'web_console_session'
const ADMIN_EMAIL = 'unicornveryevil@gmail.com'
const ADMIN_PASSWORD = '101010'
const CLIENT_PASSWORD = '1234'
const PROVIDER_LOGIN = 'Nariman'
const PROVIDER_PASSWORD = 'Nariman'
const PROVIDER_STATUS_LABEL = 'on en market'

type AuthedRequest = Request & { webSession?: WebSession }

function createSessionStore() {
  const sessions = new Map<string, WebSession>()
  return {
    create(session: Omit<WebSession, 'id'>): WebSession {
      const id = crypto.randomUUID()
      const stored = { id, ...session }
      sessions.set(id, stored)
      return stored
    },
    delete(id: string): void {
      sessions.delete(id)
    },
    get(id: string): WebSession | undefined {
      return sessions.get(id)
    }
  }
}

function publicSession(session: WebSession) {
  return {
    role: session.role,
    email: session.email,
    clientId: session.clientId
  }
}

function resolveClientDolphinCredentials(client: { calendarEmail: string }) {
  const calendarEmail = String(client.calendarEmail ?? '').trim().toLowerCase()
  return {
    username: resolveDolphinSharedUserEmail(),
    password: createDolphinLeasePassword(),
    sourceEmail: calendarEmail
  }
}

function createDolphinLeasePassword(): string {
  return crypto.randomBytes(9).toString('base64url')
}

function createMockDolphinProvisioningApi() {
  let nextProfileId = 880000001
  const proxies = [
    { id: 7101, name: 'Mock Person prepared proxy', browser_profiles_count: 0 },
    { id: 7102, name: 'Ready 1', browser_profiles_count: 0 }
  ]
  return {
    async getProfile() {
      return {
        name: 'Test of DNS',
        platform: 'windows',
        browserType: 'anty',
        platformVersion: '11',
        fingerprint: { mock: true },
        proxy: { id: 999 }
      }
    },
    async listProxies() {
      return proxies
    },
    async createProfile() {
      return { data: { id: nextProfileId++ } }
    },
    async updateProxy(proxyId: number, patch: Record<string, unknown>) {
      const proxy = proxies.find(item => Number(item.id) === Number(proxyId))
      if (proxy && typeof patch.name === 'string') proxy.name = patch.name
      return { ok: true }
    },
    async updateProfileTags() {
      return { ok: true }
    }
  }
}

async function buildProfileAccessInput(repository: WebConsoleRepository, clientId: number) {
  const [profileIds, knownProfileIds] = await Promise.all([
    repository.getDolphinProfileIdsForClient(clientId),
    repository.getAllDolphinProfileIds()
  ])
  if (!profileIds.length) {
    const error = new Error(`No Dolphin profiles are linked to client ${clientId}.`) as Error & { code?: string }
    error.code = 'missing_dolphin_profiles'
    throw error
  }
  return { profileIds, knownProfileIds }
}

async function ensureProfileAccessInput(options: {
  repository: WebConsoleRepository
  provisioner: DolphinProfileProvisioner
  client: any
  actorRole: 'client' | 'admin' | 'provider'
}) {
  const existingProfiles = await options.repository.getDolphinProfilesForClient(options.client.id)
  if (!existingProfiles.length && options.actorRole === 'provider') {
    const error = new Error(`No Dolphin profiles are linked to client ${options.client.id}.`) as Error & { code?: string }
    error.code = 'missing_dolphin_profiles'
    throw error
  }
  if (options.actorRole === 'client' || options.actorRole === 'admin') {
    const preparedClient = await prepareJudosharkClientIfNeeded(options.repository, options.client)
    await options.provisioner.ensureClientProfiles({
      client: preparedClient,
      existingProfiles,
      actorRole: options.actorRole
    })
  }
  return await buildProfileAccessInput(options.repository, options.client.id)
}

function createWebConsoleApp(options: {
  repository?: WebConsoleRepository
  dolphinLeaseService?: DolphinLeaseService
  dolphinProfileProvisioner?: DolphinProfileProvisioner
  dolphinProvisioningApi?: any
  dolphinTemplateProfileId?: number
  verificationCodeService?: VerificationCodeService
  useMockData?: boolean
} = {}) {
  const repository =
    options.repository ??
    createWebConsoleRepository({
      nocoClient: options.useMockData || process.env.WEB_CONSOLE_USE_MOCK_DATA === 'true'
        ? createMockNocoClient()
        : undefined
    })
  const dolphinLeaseService = options.dolphinLeaseService ?? createDefaultDolphinLeaseService()
  const useMockData = options.useMockData || process.env.WEB_CONSOLE_USE_MOCK_DATA === 'true'
  const dolphinProfileProvisioner = options.dolphinProfileProvisioner ?? createDolphinProfileProvisioner({
    repository,
    api: options.dolphinProvisioningApi ?? (useMockData ? createMockDolphinProvisioningApi() : undefined),
    templateProfileId: options.dolphinTemplateProfileId ?? (useMockData ? 1 : undefined)
  })
  const verificationCodeService = options.verificationCodeService ?? createDefaultVerificationCodeService()
  const sessions = createSessionStore()
  const app = express()

  app.use(express.json())
  app.use(cookieParser())

  function attachSession(req: AuthedRequest, _res: Response, next: NextFunction): void {
    const sessionId = String(req.cookies?.[SESSION_COOKIE] ?? '')
    req.webSession = sessionId ? sessions.get(sessionId) : undefined
    next()
  }

  function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
    if (!req.webSession) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }

  function requireRole(role: UserRole) {
    return (req: AuthedRequest, res: Response, next: NextFunction): void => {
      if (!req.webSession) {
        res.status(401).json({ error: 'unauthorized' })
        return
      }
      if (req.webSession.role !== role) {
        res.status(403).json({ error: 'forbidden' })
        return
      }
      next()
    }
  }

  function setSessionCookie(res: Response, session: WebSession): void {
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/'
    })
  }

  function clearSessionCookie(res: Response): void {
    res.clearCookie(SESSION_COOKIE, { path: '/' })
  }

  app.use(attachSession)

  app.get('/oauth2callback', (req: Request, res: Response) => {
    const code = String(req.query?.code ?? '').trim()
    const error = String(req.query?.error ?? '').trim()
    res.type('text/plain')
    if (error) {
      res.send(`Google OAuth returned an error: ${error}`)
      return
    }
    if (!code) {
      res.send('Google OAuth callback opened, but no code query parameter was found.')
      return
    }
    res.send([
      'Google OAuth code received.',
      '',
      'Run this in PowerShell:',
      `npm run web:gmail:token -- --code="${code}"`,
      '',
      'Then add the printed DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN to .env.'
    ].join('\n'))
  })

  app.post('/api/auth/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase()
      const login = String(req.body?.email ?? '').trim()
      const password = String(req.body?.password ?? '')

      if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        const session = sessions.create({ role: 'admin', email })
        setSessionCookie(res, session)
        res.json(publicSession(session))
        return
      }

      if (login.toLowerCase() === PROVIDER_LOGIN.toLowerCase() && password === PROVIDER_PASSWORD) {
        const session = sessions.create({ role: 'provider', email: PROVIDER_LOGIN })
        setSessionCookie(res, session)
        res.json(publicSession(session))
        return
      }

      if (password !== CLIENT_PASSWORD) {
        res.status(401).json({ error: 'invalid_credentials' })
        return
      }

      const client = await repository.findClientByCalendarEmail(email)
      if (!client) {
        res.status(401).json({ error: 'invalid_credentials' })
        return
      }

      const session = sessions.create({ role: 'client', email, clientId: client.id })
      setSessionCookie(res, session)
      res.json(publicSession(session))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    res.json(publicSession(req.webSession!))
  })

  app.post('/api/auth/logout', (req: AuthedRequest, res: Response) => {
    if (req.webSession) sessions.delete(req.webSession.id)
    clearSessionCookie(res)
    res.json({ ok: true })
  })

  app.get('/api/client/me', requireRole('client'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await repository.getClientDashboard(Number(req.webSession!.clientId), { fullAccess: false }))
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/client/me', requireRole('client'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await repository.updateClientProfile(Number(req.webSession!.clientId), req.body ?? {}))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/client/profile-options', requireRole('client'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const [englishLevels, platforms] = await Promise.all([
        repository.listEnglishLevels(),
        repository.listPlatforms()
      ])
      res.json({ englishLevels, platforms })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/platforms', requireRole('client'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ platforms: await repository.listPlatforms() })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/client/platform-accounts', requireRole('client'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await repository.createPlatformAccount(Number(req.webSession!.clientId), req.body ?? {}))
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/client/platform-accounts/:id', requireRole('client'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const accountId = Number(req.params.id)
      if (!Number.isFinite(accountId) || accountId <= 0) {
        res.status(400).json({ error: 'invalid_account_id' })
        return
      }
      res.json(await repository.updatePlatformAccount(Number(req.webSession!.clientId), accountId, req.body ?? {}))
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/client/platform-accounts/:id', requireRole('client'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const accountId = Number(req.params.id)
      if (!Number.isFinite(accountId) || accountId <= 0) {
        res.status(400).json({ error: 'invalid_account_id' })
        return
      }
      res.json(await repository.deletePlatformAccount(Number(req.webSession!.clientId), accountId))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/provider/clients', requireRole('provider'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json({
        clients: await repository.getProviderClientsForStatus(PROVIDER_STATUS_LABEL),
        providerDolphinEmail: resolveDolphinSharedUserEmail()
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/dolphin/lease/acquire', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    let attemptedUsername = ''
    let targetClientId: number | undefined
    let targetClientName = ''
    try {
      const session = req.webSession!
      if (session.role === 'client') {
        const dashboard = await repository.getClientDashboard(Number(session.clientId), { fullAccess: false })
        if (!dashboard.client.calendarEmail) {
          res.status(400).json({ error: 'missing_client_email', message: 'Client calendar email is empty.' })
          return
        }
        const credential = resolveClientDolphinCredentials(dashboard.client)
        const profileAccess = await ensureProfileAccessInput({
          repository,
          provisioner: dolphinProfileProvisioner,
          client: dashboard.client,
          actorRole: 'client'
        })
        attemptedUsername = credential.username
        targetClientId = dashboard.client.id
        targetClientName = dashboard.client.clientName
        res.json(await dolphinLeaseService.acquire({
          ownerKey: `client:${dashboard.client.id}`,
          ownerLabel: dashboard.client.clientName,
          role: 'client',
          targetClientId: dashboard.client.id,
          targetClientName: dashboard.client.clientName,
          username: credential.username,
          password: credential.password,
          sourceEmail: credential.sourceEmail,
          profileIds: profileAccess.profileIds,
          knownProfileIds: profileAccess.knownProfileIds
        }))
        return
      }

      if (session.role === 'admin') {
        const requestedClientId = Number(req.body?.targetClientId)
        const dashboard = Number.isFinite(requestedClientId) && requestedClientId > 0
          ? await repository.getClientDashboard(requestedClientId, { fullAccess: true })
          : await repository.getLatestClientDashboard({ fullAccess: true })
        const profileAccess = await ensureProfileAccessInput({
          repository,
          provisioner: dolphinProfileProvisioner,
          client: dashboard.client,
          actorRole: 'admin'
        })
        attemptedUsername = resolveDolphinSharedUserEmail()
        targetClientId = dashboard.client.id
        targetClientName = dashboard.client.clientName
        res.json(await dolphinLeaseService.acquire({
          ownerKey: `admin:${session.email}`,
          ownerLabel: 'Admin',
          role: 'admin',
          targetClientId: dashboard.client.id,
          targetClientName: dashboard.client.clientName,
          username: resolveDolphinSharedUserEmail(),
          password: createDolphinLeasePassword(),
          profileIds: profileAccess.profileIds,
          knownProfileIds: profileAccess.knownProfileIds
        }))
        return
      }

      const providerTargetClientId = Number(req.body?.targetClientId)
      if (!Number.isFinite(providerTargetClientId) || providerTargetClientId <= 0) {
        res.status(400).json({ error: 'missing_target_client', message: 'Provider target client id is required.' })
        return
      }
      const targetClient = await repository.getProviderClientByIdForStatus(providerTargetClientId, PROVIDER_STATUS_LABEL)
      if (!targetClient) {
        res.status(404).json({ error: 'target_client_not_found', message: 'Provider target client is not visible.' })
        return
      }
      const profileAccess = await ensureProfileAccessInput({
        repository,
        provisioner: dolphinProfileProvisioner,
        client: targetClient,
        actorRole: 'provider'
      })
      attemptedUsername = resolveDolphinSharedUserEmail()
      targetClientId = targetClient.id
      targetClientName = targetClient.clientName
      res.json(await dolphinLeaseService.acquire({
        ownerKey: 'provider:Nariman',
        ownerLabel: 'Nariman',
        role: 'provider',
        targetClientId: targetClient.id,
        targetClientName: targetClient.clientName,
        username: resolveDolphinSharedUserEmail(),
        password: createDolphinLeasePassword(),
        profileIds: profileAccess.profileIds,
        knownProfileIds: profileAccess.knownProfileIds
      }))
    } catch (error: any) {
      if (error?.code === 'account_in_use') {
        res.status(409).json({
          error: 'account_in_use',
          message: 'account in use sorry',
          activeUntil: error.activeUntil,
          ownerLabel: error.ownerLabel
        })
        return
      }
      if (error?.code === 'missing_dolphin_profiles') {
        res.status(404).json({
          error: 'missing_dolphin_profiles',
          message: error.message
        })
        return
      }
      if (
        error?.code === 'missing_dolphin_profile_personal_data' ||
        error?.code === 'dolphin_profile_provisioning_blocked' ||
        error?.code === 'dolphin_profile_proxy_unavailable'
      ) {
        res.status(422).json({
          error: error.code,
          message: error.message
        })
        return
      }
      if (error?.code === 'stable_dolphin_email_unavailable') {
        res.status(422).json({
          error: 'stable_dolphin_email_unavailable',
          message: `Stable Dolphin login ${error.stableUsername} is not available in Dolphin. Choose another stable email or free this email in Dolphin.`,
          attemptedUsername: error.stableUsername || attemptedUsername,
          sharedUserId: error.targetUserId || resolveDolphinSharedUserId(),
          targetClientId,
          targetClientName,
          dolphin: error.dolphinError
        })
        return
      }
      const dolphinError = normalizeDolphinErrorDetails(error)
      if (dolphinError?.code === 'E_TEAM_USERNAME') {
        res.status(422).json({
          error: 'dolphin_email_rejected',
          message: `Dolphin rejected ${attemptedUsername || 'this email'} as a team-user login.`,
          attemptedUsername,
          sharedUserId: resolveDolphinSharedUserId(),
          targetClientId,
          targetClientName,
          dolphin: dolphinError
        })
        return
      }
      next(error)
    }
  })

  app.get('/api/dolphin/verification-code/latest', requireAuth, async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await verificationCodeService.getLatestCode())
    } catch (error: any) {
      if (error?.code === 'code_not_found') {
        res.status(404).json({
          error: 'code_not_found',
          message: error.message
        })
        return
      }
      if (error?.code === 'mailbox_setup_error') {
        res.status(503).json({
          error: 'mailbox_setup_error',
          message: error.message
        })
        return
      }
      next(error)
    }
  })

  app.get('/api/admin/latest-client', requireRole('admin'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await repository.getLatestClientDashboard({ fullAccess: true }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/hh-responses/start', requireRole('admin'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const dashboard = await repository.getLatestClientDashboard({ fullAccess: true })
      res.json({
        ok: true,
        dryRun: true,
        message: 'Dry run only. Dolphin/orchestrator was not started.',
        plannedCommand: {
          command: 'npm run orchestrator',
          env: {
            APP_DB: 'noco',
            ORCHESTRATOR_CLIENT_NAMES: dashboard.client.clientName,
            ORCHESTRATOR_WORK_WITH_MARKET: String(dashboard.client.market || 'ru').toLowerCase(),
            ORCHESTRATOR_RESPONSE_LIMIT: '5'
          }
        }
      })
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((error as any)?.code === 'not_found') {
      res.status(404).json({ error: 'not_found', message: error instanceof Error ? error.message : String(error) })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    res.status(500).json({ error: 'internal_error', message })
  })

  return app
}

module.exports = {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  CLIENT_PASSWORD,
  PROVIDER_LOGIN,
  PROVIDER_PASSWORD,
  SESSION_COOKIE,
  createSessionStore,
  createWebConsoleApp,
  buildProfileAccessInput,
  ensureProfileAccessInput,
  publicSession,
  resolveClientDolphinCredentials
}
