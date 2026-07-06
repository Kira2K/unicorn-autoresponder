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
const { createTelegramService } = require('./telegram-service.ts') as {
  createTelegramService(options: { repository: WebConsoleRepository; adapter?: any; proxyResolver?: any }): TelegramService
}
const {
  buildProxyName,
  buildProfileName,
  buildProxyNameExample,
  createDolphinProfileProvisioner,
  getRequiredClientDataIssues,
  requiredLocalesForMarket,
  prepareJudosharkClientIfNeeded
} = require('./dolphin-profile-provisioning.ts') as {
  buildProxyName(client: any, enProfileId: number): string
  buildProfileName(client: any, locale: 'ru' | 'en'): string
  buildProxyNameExample(client: any): string
  createDolphinProfileProvisioner(options: {
    repository: WebConsoleRepository
    api?: any
    templateProfileId?: number
  }): DolphinProfileProvisioner
  getRequiredClientDataIssues(client: any, options?: { requireCalendarEmail?: boolean }): Array<{
    field: string
    fieldLabel: string
    message: string
  }>
  requiredLocalesForMarket(market: unknown): Array<'ru' | 'en'>
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
    ownProxy?: boolean
  }): Promise<unknown>
}
type VerificationCodeService = {
  getLatestCode(): Promise<unknown>
}
type TelegramService = {
  connect(clientId: number, input: { accountId?: number; phone?: string; code?: string; password?: string }): Promise<unknown>
  status(clientId: number, accountId?: number): Promise<unknown>
  folders(clientId: number, accountId?: number): Promise<unknown>
  dialogs(clientId: number, input?: { accountId?: number; list?: string; folderId?: number; query?: string; limit?: number }): Promise<unknown>
  messages(clientId: number, input: { accountId?: number; chatId: string; limit?: number }): Promise<unknown>
  send(clientId: number, input: { accountId?: number; chatId: string; text: string; allowWrite?: boolean }): Promise<unknown>
  listAdminSenders(): Promise<unknown>
  sendToUsername(clientId: number, input: { accountId?: number; username: string; text: string; attachments?: Array<{ fileName: string; mimeType?: string; dataBase64: string }>; allowWrite?: boolean }): Promise<unknown>
  renameContact(clientId: number, input: { accountId?: number; chatId: string; firstName: string; lastName?: string }): Promise<unknown>
  reauth(clientId: number, accountId?: number): Promise<unknown>
  disconnect(clientId: number, accountId?: number): Promise<unknown>
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

function createMissingDataError(issues: Array<{ field: string; fieldLabel: string; message: string }>) {
  const first = issues[0]
  return Object.assign(new Error(first?.message || 'Required Dolphin profile data is missing.'), {
    code: 'missing_dolphin_profile_personal_data',
    field: first?.field,
    fieldLabel: first?.fieldLabel,
    requiredFields: issues
  })
}

function createMissingProfilesError(clientId: number, missingLocales?: string[]) {
  return Object.assign(new Error(`No required Dolphin profiles are linked to client ${clientId}.`), {
    code: 'missing_dolphin_profiles',
    missingLocales
  })
}

function safeRequiredLocales(client: any): Array<'ru' | 'en'> {
  try {
    return requiredLocalesForMarket(client.market)
  } catch {
    return []
  }
}

function localeSortValue(locale: string): number {
  return locale === 'ru' ? 0 : locale === 'en' ? 1 : 2
}

async function getDolphinProfileStatus(options: {
  repository: WebConsoleRepository
  client: any
  actorRole: 'client' | 'admin' | 'provider'
}) {
  const requireCalendarEmail = options.actorRole === 'client'
  const requiredFields = getRequiredClientDataIssues(options.client, { requireCalendarEmail })
  const existingProfiles = await options.repository.getDolphinProfilesForClient(options.client.id)
  const requiredLocales = requiredFields.length ? [] : safeRequiredLocales(options.client)
  const existingLocales = new Set(existingProfiles.map(profile => String(profile.locale || '').toLowerCase()))
  const missingLocales = requiredLocales.filter(locale => !existingLocales.has(locale))
  const expectedProfileNames = requiredFields.length
    ? []
    : requiredLocales.map(locale => ({
      locale,
      name: buildProfileName(options.client, locale)
    }))
  const expectedProxyName = !requiredFields.length && requiredLocales.includes('en')
    ? buildProxyNameExample(options.client)
    : ''

  return {
    targetClientId: options.client.id,
    targetClientName: options.client.clientName,
    actorRole: options.actorRole,
    action: requiredFields.length
      ? 'blocked'
      : missingLocales.length
        ? 'create_new'
        : 'open_existing',
    existingProfiles: existingProfiles.sort((a, b) => localeSortValue(a.locale) - localeSortValue(b.locale) || a.id - b.id),
    requiredLocales,
    missingLocales,
    expectedProfileNames,
    expectedProxyName,
    requiredFields
  }
}

function assertProfileStatusUsable(status: Awaited<ReturnType<typeof getDolphinProfileStatus>>) {
  if (status.requiredFields.length) {
    throw createMissingDataError(status.requiredFields)
  }
}

async function ensureProfileAccessInput(options: {
  repository: WebConsoleRepository
  provisioner: DolphinProfileProvisioner
  client: any
  actorRole: 'client' | 'admin' | 'provider'
  mode?: 'open_existing' | 'create_new'
  ownProxy?: boolean
}) {
  const mode = options.mode ?? 'create_new'
  const status = await getDolphinProfileStatus({
    repository: options.repository,
    client: options.client,
    actorRole: options.actorRole
  })
  assertProfileStatusUsable(status)
  const existingProfiles = await options.repository.getDolphinProfilesForClient(options.client.id)
  if (mode === 'open_existing') {
    if (status.missingLocales.length) {
      throw createMissingProfilesError(options.client.id, status.missingLocales)
    }
    return await buildProfileAccessInput(options.repository, options.client.id)
  }
  if (options.actorRole === 'provider') {
    if (status.missingLocales.length) {
      throw createMissingProfilesError(options.client.id, status.missingLocales)
    }
    return await buildProfileAccessInput(options.repository, options.client.id)
  }
  if (options.actorRole === 'client' || options.actorRole === 'admin') {
    const preparedClient = await prepareJudosharkClientIfNeeded(options.repository, options.client)
    await options.provisioner.ensureClientProfiles({
      client: preparedClient,
      existingProfiles,
      actorRole: options.actorRole,
      ownProxy: options.ownProxy
    })
  }
  return await buildProfileAccessInput(options.repository, options.client.id)
}

async function buildOwnProxyName(repository: WebConsoleRepository, client: any): Promise<string> {
  const profiles = await repository.getDolphinProfilesForClient(client.id)
  const enProfile = profiles.find(profile => String(profile.locale || '').toLowerCase() === 'en')
  return enProfile ? buildProxyName(client, enProfile.id) : ''
}

function createWebConsoleApp(options: {
  repository?: WebConsoleRepository
  dolphinLeaseService?: DolphinLeaseService
  dolphinProfileProvisioner?: DolphinProfileProvisioner
  dolphinProvisioningApi?: any
  dolphinTemplateProfileId?: number
  verificationCodeService?: VerificationCodeService
  telegramService?: TelegramService
  telegramAdapter?: any
  telegramProxyResolver?: any
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
  const telegramService = options.telegramService ?? createTelegramService({
    repository,
    adapter: options.telegramAdapter,
    proxyResolver: options.telegramProxyResolver ?? (useMockData
      ? async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
      : undefined)
  })
  const sessions = createSessionStore()
  const app = express()

  app.use(express.json({ limit: '25mb' }))
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
      'Before approving again, make the Google OAuth consent screen Production if it is still Testing.',
      'Testing-mode refresh tokens expire quickly; Production-mode tokens last much longer unless revoked by Google/account changes.',
      '',
      'Run this in PowerShell:',
      `npm run web:gmail:token -- --code="${code}"`,
      '',
      'Then add the printed DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN to .env and Render secrets.',
      'Restart the backend/Render service and validate with:',
      'npm run web:gmail:token -- --check'
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

  app.get('/api/dolphin/profiles/status', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const session = req.webSession!
      if (session.role === 'client') {
        const dashboard = await repository.getClientDashboard(Number(session.clientId), { fullAccess: false })
        res.json(await getDolphinProfileStatus({
          repository,
          client: dashboard.client,
          actorRole: 'client'
        }))
        return
      }

      if (session.role === 'admin') {
        const requestedClientId = Number(req.query?.targetClientId)
        const dashboard = Number.isFinite(requestedClientId) && requestedClientId > 0
          ? await repository.getClientDashboard(requestedClientId, { fullAccess: true })
          : await repository.getLatestClientDashboard({ fullAccess: true })
        res.json(await getDolphinProfileStatus({
          repository,
          client: dashboard.client,
          actorRole: 'admin'
        }))
        return
      }

      const providerTargetClientId = Number(req.query?.targetClientId)
      if (!Number.isFinite(providerTargetClientId) || providerTargetClientId <= 0) {
        res.status(400).json({ error: 'missing_target_client', message: 'Provider target client id is required.' })
        return
      }
      const targetClient = await repository.getProviderClientByIdForStatus(providerTargetClientId, PROVIDER_STATUS_LABEL)
      if (!targetClient) {
        res.status(404).json({ error: 'target_client_not_found', message: 'Provider target client is not visible.' })
        return
      }
      res.json(await getDolphinProfileStatus({
        repository,
        client: await repository.getClientById(targetClient.id),
        actorRole: 'provider'
      }))
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
      const mode = req.body?.mode === 'open_existing' ? 'open_existing' : 'create_new'
      const ownProxy = Boolean(req.body?.ownProxy)
      if (session.role === 'client') {
        const dashboard = await repository.getClientDashboard(Number(session.clientId), { fullAccess: false })
        const credential = resolveClientDolphinCredentials(dashboard.client)
        const profileAccess = await ensureProfileAccessInput({
          repository,
          provisioner: dolphinProfileProvisioner,
          client: dashboard.client,
          actorRole: 'client',
          mode,
          ownProxy
        })
        attemptedUsername = credential.username
        targetClientId = dashboard.client.id
        targetClientName = dashboard.client.clientName
        const lease = await dolphinLeaseService.acquire({
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
        })
        const ownProxyName = mode === 'create_new' && ownProxy
          ? await buildOwnProxyName(repository, dashboard.client)
          : ''
        res.json(ownProxyName ? { ...(lease as any), ownProxyName } : lease)
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
          actorRole: 'admin',
          mode,
          ownProxy
        })
        attemptedUsername = resolveDolphinSharedUserEmail()
        targetClientId = dashboard.client.id
        targetClientName = dashboard.client.clientName
        const lease = await dolphinLeaseService.acquire({
          ownerKey: `admin:${session.email}`,
          ownerLabel: 'Admin',
          role: 'admin',
          targetClientId: dashboard.client.id,
          targetClientName: dashboard.client.clientName,
          username: resolveDolphinSharedUserEmail(),
          password: createDolphinLeasePassword(),
          profileIds: profileAccess.profileIds,
          knownProfileIds: profileAccess.knownProfileIds
        })
        const ownProxyName = mode === 'create_new' && ownProxy
          ? await buildOwnProxyName(repository, dashboard.client)
          : ''
        res.json(ownProxyName ? { ...(lease as any), ownProxyName } : lease)
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
      const fullTargetClient = await repository.getClientById(targetClient.id)
      const profileAccess = await ensureProfileAccessInput({
        repository,
        provisioner: dolphinProfileProvisioner,
        client: fullTargetClient,
        actorRole: 'provider',
        mode: 'open_existing'
      })
      attemptedUsername = resolveDolphinSharedUserEmail()
      targetClientId = fullTargetClient.id
      targetClientName = fullTargetClient.clientName
      res.json(await dolphinLeaseService.acquire({
        ownerKey: 'provider:Nariman',
        ownerLabel: 'Nariman',
        role: 'provider',
        targetClientId: fullTargetClient.id,
        targetClientName: fullTargetClient.clientName,
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
          message: error.message,
          missingLocales: error.missingLocales
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
          message: error.message,
          field: error.field,
          fieldLabel: error.fieldLabel,
          requiredFields: error.requiredFields,
          targetClientId,
          targetClientName
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
          reason: error.reason,
          message: error.message
        })
        return
      }
      next(error)
    }
  })

  function telegramAccountId(value: unknown): number | undefined {
    const id = Number(value)
    return Number.isFinite(id) && id > 0 ? id : undefined
  }

  function telegramTargetClientId(req: AuthedRequest): number {
    const session = req.webSession!
    if (session.role === 'client') return Number(session.clientId)
    if (session.role === 'admin') {
      const raw = (req.body?.targetClientId ?? req.query?.targetClientId)
      const id = Number(raw)
      if (Number.isFinite(id) && id > 0) return id
      throw Object.assign(new Error('Admin target client id is required.'), { code: 'missing_target_client' })
    }
    throw Object.assign(new Error('Telegram is not available for this role.'), { code: 'forbidden' })
  }

  app.post('/api/telegram/connect', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.connect(clientId, {
        accountId: telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId),
        phone: String(req.body?.phone ?? '').trim() || undefined,
        code: String(req.body?.code ?? '').trim() || undefined,
        password: String(req.body?.password ?? '').trim() || undefined
      }))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/telegram/status', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.status(clientId, telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId)))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/telegram/dialogs', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      const limit = Number(req.query?.limit)
      const folderId = Number(req.query?.folderId)
      res.json(await telegramService.dialogs(clientId, {
        accountId: telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId),
        list: String(req.query?.list ?? 'main').trim() || 'main',
        folderId: Number.isFinite(folderId) && folderId > 0 ? folderId : undefined,
        query: String(req.query?.query ?? '').trim() || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined
      }))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/telegram/folders', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.folders(clientId, telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId)))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/telegram/messages', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.query?.chatId ?? '').trim()
      if (!chatId) {
        res.status(400).json({ error: 'missing_chat_id' })
        return
      }
      const clientId = telegramTargetClientId(req)
      const limit = Number(req.query?.limit)
      res.json(await telegramService.messages(clientId, {
        accountId: telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId),
        chatId,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined
      }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/telegram/send', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.body?.chatId ?? '').trim()
      const text = String(req.body?.text ?? '').trim()
      if (!chatId || !text) {
        res.status(400).json({ error: 'missing_message_input' })
        return
      }
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.send(clientId, {
        accountId: telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId),
        chatId,
        text,
        allowWrite: req.body?.allowWrite === true
      }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/telegram/rename-contact', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.body?.chatId ?? '').trim()
      const firstName = String(req.body?.firstName ?? '').trim()
      const lastName = String(req.body?.lastName ?? '').trim()
      if (!chatId || !firstName) {
        res.status(400).json({ error: 'missing_telegram_contact_name' })
        return
      }
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.renameContact(clientId, {
        accountId: telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId),
        chatId,
        firstName,
        lastName: lastName || undefined
      }))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/admin/telegram/senders', requireRole('admin'), async (_req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await telegramService.listAdminSenders())
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/telegram/send', requireRole('admin'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = Number(req.body?.targetClientId)
      const accountId = telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId)
      const username = String(req.body?.username ?? '').trim()
      const text = String(req.body?.text ?? '')
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : []
      if (!Number.isFinite(clientId) || clientId <= 0 || !accountId || !username) {
        res.status(400).json({ error: 'missing_admin_telegram_send_input' })
        return
      }
      res.json(await telegramService.sendToUsername(clientId, {
        accountId,
        username,
        text,
        attachments,
        allowWrite: true
      }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/telegram/reauth', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.reauth(clientId, telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId)))
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/telegram/disconnect', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.disconnect(clientId, telegramAccountId(req.body?.platformAccountId ?? req.body?.accountId ?? req.query?.platformAccountId ?? req.query?.accountId)))
    } catch (error) {
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
    if ((error as any)?.code === 'forbidden') {
      res.status(403).json({ error: 'forbidden', message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'missing_target_client' || (error as any)?.code === 'telegram_account_not_found') {
      res.status(404).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (
      (error as any)?.code === 'telegram_readonly' ||
      (error as any)?.code === 'telegram_rename_not_supported' ||
      (error as any)?.code === 'telegram_rename_invalid_name' ||
      (error as any)?.code === 'telegram_invalid_username' ||
      (error as any)?.code === 'telegram_empty_message' ||
      (error as any)?.code === 'telegram_sender_inactive' ||
      (error as any)?.code === 'telegram_attachment_missing' ||
      (error as any)?.code === 'telegram_attachment_invalid'
    ) {
      res.status(400).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'telegram_connecting') {
      res.status(409).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'telegram_tdlib_timeout' || (error as any)?.code === 'telegram_file_send_failed') {
      res.status(504).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
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
