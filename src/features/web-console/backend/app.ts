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
  configuredTelegramService,
  createTelegramGatewayController,
  safeGatewayFailure
} = require('./telegram-gateway.ts') as {
  configuredTelegramService(localService: TelegramService, options?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): TelegramService
  createTelegramGatewayController(options: {
    service: TelegramService
    env?: Record<string, string | undefined>
    logger?: (event: Record<string, unknown>) => void
  }): {
    authenticate(header: unknown): { ok: true } | { ok: false; statusCode: number; body: Record<string, unknown> }
    health(): unknown
    execute(body: unknown, options?: { signal?: AbortSignal; requestId?: string }): Promise<unknown>
  }
  safeGatewayFailure(error: unknown): { statusCode: number; body: Record<string, unknown> }
}
const { createTelegramBotApi } = require('../../../integrations/telegram/bot-api.ts') as {
  createTelegramBotApi(options?: any): TelegramBotApi
}
const {
  getProviderTaskById,
  getProviderTasks,
  getResumeStatus,
  publicWorkflow,
  rejectResumeWorkflow,
  rejectResumeWorkflowById,
  resetResumeWorkflowForTest,
  resumeWorkflow,
  resumeWorkflowById,
  saveKiraCommentsFromChat,
  saveResumeTaskInputFromChat
} = require('../../../integrations/telegram/resume-workflow.ts') as {
  getProviderTaskById(workflowId: number, repository: WebConsoleRepository, actor?: any): Promise<any>
  getProviderTasks(repository: WebConsoleRepository, actor?: any, options?: any): Promise<any>
  getResumeStatus(chatId: string, repository: WebConsoleRepository, options?: any): Promise<any>
  publicWorkflow(record: any): any
  rejectResumeWorkflow(chatId: string, repository: WebConsoleRepository, options?: any): Promise<any>
  rejectResumeWorkflowById(workflowId: number, repository: WebConsoleRepository, options?: any): Promise<any>
  resetResumeWorkflowForTest(chatId: string, repository: WebConsoleRepository): Promise<any>
  resumeWorkflow(chatId: string, repository: WebConsoleRepository, options?: any): Promise<any>
  resumeWorkflowById(workflowId: number, repository: WebConsoleRepository, options?: any): Promise<any>
  saveKiraCommentsFromChat(repository: WebConsoleRepository, actor?: any, comments?: string): Promise<any>
  saveResumeTaskInputFromChat(repository: WebConsoleRepository, actor?: any, text?: string, options?: any): Promise<any>
}
const { sendTelegramMessage } = require('../../../integrations/telegram/messenger.ts') as {
  sendTelegramMessage(to: string, message: string, options?: { parseMode?: false | 'html' | 'md' | 'markdown' }): Promise<void>
}
const { SUMMARY_LOGS_CHANNEL_ID } = require('../../hh-responses/orchestrator/config.ts') as {
  SUMMARY_LOGS_CHANNEL_ID?: string
}
const {
  buildProxyName,
  createDolphinProfileProvisioner,
  prepareJudosharkClientIfNeeded
} = require('./dolphin-profile-provisioning.ts') as {
  buildProxyName(client: any, enProfileId: number): string
  createDolphinProfileProvisioner(options: {
    repository: WebConsoleRepository
    api?: any
    templateProfileId?: number
  }): DolphinProfileProvisioner
  prepareJudosharkClientIfNeeded(repository: WebConsoleRepository, client: any): Promise<any>
}
const { buildDolphinProfileStatus } = require('./dolphin-profile-status.ts') as {
  buildDolphinProfileStatus(options: {
    client: any
    existingProfiles: Array<{ id: number; locale: string }>
    actorRole: 'client' | 'admin' | 'provider'
  }): import('./types.ts').DolphinProfileStatus
}
const { createLinkedInAuthRunService } = require('./linkedin-auth-runs.ts') as {
  createLinkedInAuthRunService(options?: any): import('./linkedin-auth-types.ts').LinkedInAuthRunService
}
const { createLinkedInAuthNocoRepository } = require('../../linkedin-automation/account-connection/noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}
const { createMockLinkedInAuthRunService } = require('./linkedin-auth-mock.ts') as {
  createMockLinkedInAuthRunService(): import('./linkedin-auth-types.ts').LinkedInAuthRunService
}
const { registerLinkedInAuthRoutes } = require('./linkedin-auth-routes.ts') as {
  registerLinkedInAuthRoutes(options: any): void
}
const { createLinkedInOperationGate } = require('./linkedin-operation-gate.ts') as {
  createLinkedInOperationGate(): any
}
const { createProfileFillerService } = require('../../linkedin-automation/profile-filler/service.ts') as {
  createProfileFillerService(options?: any): import('./profile-filler-types.ts').ProfileFillerService
}
const { createMockProfileFillerService } = require('./profile-filler-mock.ts') as {
  createMockProfileFillerService(): import('./profile-filler-types.ts').ProfileFillerService
}
const { registerProfileFillerRoutes } = require('./profile-filler-routes.ts') as {
  registerProfileFillerRoutes(options: any): void
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
  status(clientId: number, accountId?: number, options?: { signal?: AbortSignal }): Promise<unknown>
  folders(clientId: number, accountId?: number, options?: { signal?: AbortSignal }): Promise<unknown>
  dialogs(clientId: number, input?: { accountId?: number; list?: string; folderId?: number; query?: string; limit?: number; privateOnly?: boolean; signal?: AbortSignal }): Promise<unknown>
  scanAdminDialogs(clientId: number, input: { accountId: number; days: number; signal?: AbortSignal }): Promise<unknown>
  messages(clientId: number, input: { accountId?: number; chatId: string; limit?: number; signal?: AbortSignal }): Promise<unknown>
  send(clientId: number, input: { accountId?: number; chatId: string; text: string; allowWrite?: boolean }): Promise<unknown>
  listAdminSenders(options?: { signal?: AbortSignal }): Promise<unknown>
  sendToUsername(clientId: number, input: { accountId?: number; username: string; text: string; attachments?: Array<{ fileName: string; mimeType?: string; dataBase64: string }>; allowWrite?: boolean }): Promise<unknown>
  renameContact(clientId: number, input: { accountId?: number; chatId: string; firstName: string; lastName?: string }): Promise<unknown>
  reauth(clientId: number, accountId?: number): Promise<unknown>
  disconnect(clientId: number, accountId?: number): Promise<unknown>
}
type TelegramBotApi = {
  sendMessage(input: { chatId: string; text: string; messageThreadId?: number; replyMarkup?: unknown; parseMode?: string }): Promise<unknown>
}
type CvTailoringRequest = {
  fileName: string
  mimeType: string
  fileBuffer: Buffer
  jobRequirements: string
}
type CvTailoringResult = {
  url: string
}
type CvTailoringService = {
  tailorFromPdf(request: CvTailoringRequest): Promise<CvTailoringResult>
}

const SESSION_COOKIE = 'web_console_session'
const ADMIN_EMAIL = 'unicornveryevil@gmail.com'
const ADMIN_PASSWORD = '101010'
const CLIENT_PASSWORD = '1234'
const PROVIDER_LOGIN = 'Nariman'
const PROVIDER_PASSWORD = 'Nariman'
const PROVIDER_STATUS_LABEL = 'on en market'
const CV_TAILORING_ENDPOINT = 'https://tailered-cv.onrender.com/cv-from-pdf'
const CV_TAILORING_MAX_PDF_BYTES = 15 * 1024 * 1024

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

async function getDolphinProfileStatus(options: {
  repository: WebConsoleRepository
  client: any
  actorRole: 'client' | 'admin' | 'provider'
}) {
  const existingProfiles = await options.repository.getDolphinProfilesForClient(options.client.id)
  return buildDolphinProfileStatus({ ...options, existingProfiles })
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

function createDefaultCvTailoringService(fetchImpl: typeof fetch = fetch): CvTailoringService {
  return {
    async tailorFromPdf(request: CvTailoringRequest): Promise<CvTailoringResult> {
      const apiKey = String(process.env.CV_TAILORING_API_KEY ?? '').trim()
      if (!apiKey) {
        throw Object.assign(new Error('CV tailoring API key is not configured.'), {
          code: 'cv_tailoring_not_configured'
        })
      }
      const formData = new FormData()
      const pdfBytes = new Uint8Array(request.fileBuffer.length)
      pdfBytes.set(request.fileBuffer)
      formData.append('cv', new Blob([pdfBytes.buffer], { type: 'application/pdf' }), request.fileName)
      formData.append('jobRequirements', request.jobRequirements)
      const response = await fetchImpl(CV_TAILORING_ENDPOINT, {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: formData
      })
      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw Object.assign(new Error(message || `CV tailoring API failed with ${response.status}`), {
          code: 'cv_tailoring_api_failed',
          status: response.status
        })
      }
      const rawUrl = (await response.text()).trim()
      const parsedUrl = extractCvTailoringUrl(rawUrl)
      if (!parsedUrl) {
        throw Object.assign(new Error('CV tailoring API returned an empty URL.'), {
          code: 'cv_tailoring_api_failed',
          status: response.status
        })
      }
      return { url: parsedUrl }
    }
  }
}

function extractCvTailoringUrl(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsedUrl = (() => {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'string') return parsed.trim()
      if (parsed && typeof parsed.url === 'string') return parsed.url.trim()
      if (parsed && typeof parsed.result === 'string') return parsed.result.trim()
      if (parsed && typeof parsed.fileUrl === 'string') return parsed.fileUrl.trim()
      return ''
    } catch {
      return raw
    }
  })()
  return parsedUrl
}

function createMockCvTailoringService(): CvTailoringService {
  return {
    async tailorFromPdf(request: CvTailoringRequest): Promise<CvTailoringResult> {
      return {
        url: `https://tailered-cv.example/mock/${encodeURIComponent(request.fileName)}`
      }
    }
  }
}

function createWebConsoleApp(options: {
  repository?: WebConsoleRepository
  dolphinLeaseService?: DolphinLeaseService
  dolphinProfileProvisioner?: DolphinProfileProvisioner
  dolphinProvisioningApi?: any
  dolphinTemplateProfileId?: number
  verificationCodeService?: VerificationCodeService
  telegramService?: TelegramService
  telegramGatewayService?: TelegramService
  telegramGatewayEnv?: Record<string, string | undefined>
  telegramGatewayFetch?: typeof fetch
  telegramGatewayLogger?: (event: Record<string, unknown>) => void
  telegramBotApi?: TelegramBotApi
  cvTailoringService?: CvTailoringService
  cvTailoringFetch?: typeof fetch
  summaryLogsChannelId?: string
  sendSummaryTelegramMessage?: typeof sendTelegramMessage
  telegramAdapter?: any
  telegramProxyResolver?: any
  linkedinAuthRuns?: import('./linkedin-auth-types.ts').LinkedInAuthRunService
  linkedinOperationGate?: any
  profileFiller?: import('./profile-filler-types.ts').ProfileFillerService
  useMockData?: boolean
} = {}) {
  const useMockData = options.useMockData ?? process.env.WEB_CONSOLE_USE_MOCK_DATA === 'true'
  const repository =
    options.repository ??
    createWebConsoleRepository({
      nocoClient: useMockData
        ? createMockNocoClient()
        : undefined
    })
  const dolphinLeaseService = options.dolphinLeaseService ?? createDefaultDolphinLeaseService()
  const linkedinOperationGate = options.linkedinOperationGate ?? createLinkedInOperationGate()
  let linkedinRepository: any
  const getLinkedInRepository = () => linkedinRepository ??= createLinkedInAuthNocoRepository()
  const lazyLinkedInRepository = new Proxy({}, {
    get(_target, property) {
      const repository = getLinkedInRepository()
      const value = repository[property]
      return typeof value === 'function' ? value.bind(repository) : value
    }
  })
  const linkedinAuthRuns = options.linkedinAuthRuns ?? (useMockData
    ? createMockLinkedInAuthRunService()
    : createLinkedInAuthRunService({ gate: linkedinOperationGate, repository: lazyLinkedInRepository }))
  const profileFiller = options.profileFiller ?? (useMockData
    ? createMockProfileFillerService()
    : createProfileFillerService({ gate: linkedinOperationGate, repository: lazyLinkedInRepository }))
  const dolphinProfileProvisioner = options.dolphinProfileProvisioner ?? createDolphinProfileProvisioner({
    repository,
    api: options.dolphinProvisioningApi ?? (useMockData ? createMockDolphinProvisioningApi() : undefined),
    templateProfileId: options.dolphinTemplateProfileId ?? (useMockData ? 1 : undefined)
  })
  const verificationCodeService = options.verificationCodeService ?? createDefaultVerificationCodeService()
  const localTelegramService = createTelegramService({
    repository,
    adapter: options.telegramAdapter,
    proxyResolver: options.telegramProxyResolver ?? (useMockData
      ? async () => ({ type: 'socks5', host: '127.0.0.1', port: 1080 })
      : undefined)
  })
  const telegramEnvironment = options.telegramGatewayEnv ?? process.env
  const telegramService = options.telegramService ?? configuredTelegramService(localTelegramService, {
    env: telegramEnvironment,
    fetchImpl: options.telegramGatewayFetch
  })
  const telegramGatewayController = createTelegramGatewayController({
    service: options.telegramGatewayService ?? localTelegramService,
    env: telegramEnvironment,
    logger: options.telegramGatewayLogger
  })
  const telegramBotApi = options.telegramBotApi ?? createTelegramBotApi()
  const cvTailoringService = options.cvTailoringService ?? (useMockData
    ? createMockCvTailoringService()
    : createDefaultCvTailoringService(options.cvTailoringFetch))
  const summaryLogsChannelId = options.summaryLogsChannelId ?? SUMMARY_LOGS_CHANNEL_ID
  const sendSummaryTelegramMessage = options.sendSummaryTelegramMessage ?? sendTelegramMessage
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

  function requireBotApiToken(req: Request, res: Response, next: NextFunction): void {
    const expected = String(process.env.WEB_CONSOLE_BOT_API_TOKEN ?? '').trim()
    const actual = String(req.header('X-Bot-Api-Token') ?? '').trim()
    if (!expected) {
      res.status(503).json({ error: 'bot_api_token_not_configured', message: 'WEB_CONSOLE_BOT_API_TOKEN is not configured.' })
      return
    }
    if (!actual || actual !== expected) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }

  function publicTelegramClient(client: any) {
    return {
      id: client.id,
      name: client.clientName,
      chatId: client.commonChatId,
      googleFolder: client.googleFolder || ''
    }
  }

  function validateGoogleFolder(value: unknown): string {
    const googleFolder = String(value ?? '').trim()
    if (!googleFolder) {
      throw Object.assign(new Error('Google folder is required.'), { code: 'invalid_google_folder' })
    }
    if (googleFolder.length > 2048) {
      throw Object.assign(new Error('Google folder is too long.'), { code: 'invalid_google_folder' })
    }
    if (!/^https?:\/\//i.test(googleFolder)) {
      throw Object.assign(new Error('Google folder must start with http:// or https://.'), { code: 'invalid_google_folder' })
    }
    return googleFolder
  }

  function validateTelegramMessage(value: unknown): string {
    const text = String(value ?? '').trim()
    if (!text) {
      throw Object.assign(new Error('Telegram message text is required.'), { code: 'telegram_empty_message' })
    }
    if (text.length > 4096) {
      throw Object.assign(new Error('Telegram message text is too long.'), { code: 'telegram_message_too_long' })
    }
    return text
  }

  function validateCvTailoringRequest(body: any): CvTailoringRequest {
    const fileName = String(body?.fileName ?? '').trim() || 'cv.pdf'
    const mimeType = String(body?.mimeType ?? '').trim() || 'application/pdf'
    const dataBase64 = String(body?.dataBase64 ?? '').trim()
    const jobRequirements = String(body?.jobRequirements ?? '').trim()
    if (!jobRequirements) {
      throw Object.assign(new Error('Job requirements are required.'), { code: 'cv_tailoring_missing_job_requirements' })
    }
    if (!dataBase64) {
      throw Object.assign(new Error('PDF file is required.'), { code: 'cv_tailoring_missing_pdf' })
    }
    if (!/\.pdf$/i.test(fileName) || mimeType !== 'application/pdf') {
      throw Object.assign(new Error('CV must be a PDF file.'), { code: 'cv_tailoring_invalid_pdf' })
    }
    const fileBuffer = Buffer.from(dataBase64, 'base64')
    if (!fileBuffer.length || fileBuffer.length > CV_TAILORING_MAX_PDF_BYTES || fileBuffer.subarray(0, 4).toString('utf8') !== '%PDF') {
      throw Object.assign(new Error('CV must be a non-empty PDF file.'), { code: 'cv_tailoring_invalid_pdf' })
    }
    return { fileName, mimeType, fileBuffer, jobRequirements }
  }

  function botActorFromRequest(req: Request) {
    return {
      userId: String(req.header('X-Telegram-User-Id') ?? req.body?.actor?.userId ?? req.query?.actorUserId ?? '').trim(),
      username: String(req.header('X-Telegram-Username') ?? req.body?.actor?.username ?? req.query?.actorUsername ?? '').trim(),
      chatId: String(req.header('X-Telegram-Chat-Id') ?? req.body?.actor?.chatId ?? req.query?.actorChatId ?? '').trim(),
      chatType: String(req.header('X-Telegram-Chat-Type') ?? req.body?.actor?.chatType ?? req.query?.actorChatType ?? '').trim()
    }
  }

  function publicResumeResult(result: any, extra: Record<string, unknown> = {}) {
    return {
      ...result,
      ...extra,
      workflow: result.workflow ? publicWorkflow(result.workflow) : undefined
    }
  }

  async function sendResumeNotifications(result: any): Promise<string[]> {
    const warnings: string[] = []
    const notifications = Array.isArray(result?.notifications) ? result.notifications : []
    const notificationTimeoutMs = Math.max(1000, Number(process.env.RESUME_WORKFLOW_NOTIFICATION_TIMEOUT_MS || 5000))

    async function withNotificationTimeout<T>(action: Promise<T>, notification: any): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          action,
          new Promise<T>((_resolve, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`notification timed out after ${notificationTimeoutMs}ms`))
            }, notificationTimeoutMs)
          })
        ])
      } catch (error) {
        throw error
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    function notificationWarning(notification: any, error: any, chatId?: string): string {
      const message = error instanceof Error ? error.message : String(error)
      const target = chatId ? ` chat ${chatId}` : ''
      if (
        (notification.kind === 'private_provider' || notification.kind === 'private_kira') &&
        /bot can't initiate conversation with a user/i.test(message)
      ) {
        return `${notification.kind}${target}: не удалось отправить уведомление. Попроси этого пользователя открыть @veu_support_bot и один раз отправить /start.`
      }
      return `${notification.kind}${target}: не удалось отправить уведомление: ${message}`
    }

    for (const notification of notifications) {
      if (notification.kind === 'hh_summary') {
        try {
          if (summaryLogsChannelId) {
            await withNotificationTimeout(
              sendSummaryTelegramMessage(summaryLogsChannelId, notification.text, { parseMode: false }),
              notification
            )
          }
        } catch (error: any) {
          warnings.push(notificationWarning(notification, error))
        }
        continue
      }

      const notificationChatIds = Array.isArray(notification.chatIds)
        ? notification.chatIds.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
        : [String(notification.chatId ?? '').trim()].filter(Boolean)

      if (!notificationChatIds.length) {
        warnings.push(`Уведомление ${notification.kind} пропущено: не указан chat id.`)
        continue
      }

      for (const chatId of notificationChatIds) {
        try {
          await withNotificationTimeout(
            telegramBotApi.sendMessage({
              chatId,
              ...(notification.messageThreadId ? { messageThreadId: notification.messageThreadId } : {}),
              text: notification.text,
              replyMarkup: notification.replyMarkup
            }),
            notification
          )
        } catch (error: any) {
          warnings.push(notificationWarning(notification, error, chatId))
        }
      }
    }

    if (warnings.length && result?.workflow?.id) {
      try {
        await repository.patchResumeWorkflow(Number(result.workflow.id), {
          lastWorkflowError: `Notification warning: ${warnings.join('; ')}`
        })
      } catch {
        // Preserve the original workflow response.
      }
    }

    return warnings
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

  function requestAbortBoundary(req: Request, res: Response) {
    const controller = new AbortController()
    const abort = () => {
      if (!res.writableEnded) controller.abort()
    }
    req.once('aborted', abort)
    res.once('close', abort)
    return {
      signal: controller.signal,
      dispose() {
        req.removeListener('aborted', abort)
        res.removeListener('close', abort)
      }
    }
  }

  function requireTelegramGateway(req: Request, res: Response, next: NextFunction): void {
    const authentication = telegramGatewayController.authenticate(req.header('Authorization'))
    if (!authentication.ok) {
      res.status(authentication.statusCode).json(authentication.body)
      return
    }
    next()
  }

  app.use(attachSession)
  registerLinkedInAuthRoutes({
    app,
    requireAdmin: requireRole('admin'),
    service: linkedinAuthRuns
  })
  registerProfileFillerRoutes({
    app,
    requireAdmin: requireRole('admin'),
    service: profileFiller
  })

  app.get('/api/internal/telegram-gateway/health', requireTelegramGateway, (_req: Request, res: Response) => {
    res.json(telegramGatewayController.health())
  })

  app.post('/api/internal/telegram-gateway/rpc', requireTelegramGateway, async (req: Request, res: Response) => {
    const boundary = requestAbortBoundary(req, res)
    try {
      const result = await telegramGatewayController.execute(req.body, {
        signal: boundary.signal,
        requestId: crypto.randomUUID()
      })
      if (!res.writableEnded && !boundary.signal.aborted) res.json({ ok: true, result })
    } catch (error) {
      if (!res.writableEnded && !boundary.signal.aborted) {
        const failure = safeGatewayFailure(error)
        res.status(failure.statusCode).json(failure.body)
      }
    } finally {
      boundary.dispose()
    }
  })

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

  app.get('/api/bot/status', requireBotApiToken, async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'web-console-backend',
      checkedAt: new Date().toISOString()
    })
  })

  app.get('/api/bot/telegram/chats/:chatId/client', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.params.chatId ?? '').trim()
      const client = await repository.findClientByTelegramChatId(chatId)
      if (!client) {
        res.json({ found: false, chatId })
        return
      }
      res.json({ found: true, chatId, client: publicTelegramClient(client) })
    } catch (error) {
      next(error)
    }
  })

  app.patch('/api/bot/telegram/chats/:chatId/google-folder', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(410).json({
        success: false,
        error: 'google_folder_telegram_edit_disabled',
        message: 'Редактирование Google-папки из Telegram отключено. Измени корневую Google-папку в админке Noco.'
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/chats/:chatId/resume', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.params.chatId ?? '').trim()
      const result = await resumeWorkflow(chatId, repository, {
        actor: botActorFromRequest(req),
        expectedStatus: req.body?.expectedStatus,
        studentDataFolderUrl: req.body?.studentDataFolderUrl
      })
      const notificationWarnings = await sendResumeNotifications(result)
      res.status(result.found ? 200 : 404).json(publicResumeResult(result, { notificationWarnings }))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/bot/telegram/chats/:chatId/resume/status', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.params.chatId ?? '').trim()
      const result = await getResumeStatus(chatId, repository, {
        actor: botActorFromRequest(req)
      })
      res.status(result.found ? 200 : 404).json(publicResumeResult(result))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/chats/:chatId/resume/reject', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.params.chatId ?? '').trim()
      const result = await rejectResumeWorkflow(chatId, repository, {
        actor: botActorFromRequest(req),
        expectedStatus: req.body?.expectedStatus,
        rejectionComment: req.body?.comment
      })
      const notificationWarnings = await sendResumeNotifications(result)
      res.status(result.found ? 200 : 404).json(publicResumeResult(result, { notificationWarnings }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/chats/:chatId/resume/reset-test', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const chatId = String(req.params.chatId ?? '').trim()
      const result = await resetResumeWorkflowForTest(chatId, repository)
      res.status(result.found ? 200 : 404).json(publicResumeResult(result))
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/bot/telegram/resume/provider/tasks', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const offset = Number(req.query.offset)
      const result = await getProviderTasks(repository, botActorFromRequest(req), {
        offset: Number.isFinite(offset) && offset > 0 ? offset : 0
      })
      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/bot/telegram/resume/workflows/:workflowId', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflowId = Number(req.params.workflowId)
      if (!Number.isFinite(workflowId) || workflowId <= 0) {
        res.status(400).json({ error: 'invalid_workflow_id' })
        return
      }
      const result = await getProviderTaskById(workflowId, repository, botActorFromRequest(req))
      res.status(result.workflow ? 200 : 404).json({
        ...result,
        workflow: result.workflow ? publicWorkflow(result.workflow) : undefined
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/resume/task-input', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflowId = Number(req.body?.workflowId)
      const result = await saveResumeTaskInputFromChat(repository, botActorFromRequest(req), req.body?.text, {
        workflowId: Number.isFinite(workflowId) && workflowId > 0 ? workflowId : undefined,
        expectedStatus: req.body?.expectedStatus
      })
      res.json({
        ...result,
        workflow: result.workflow ? publicWorkflow(result.workflow) : undefined
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/resume/kira-comments', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await saveKiraCommentsFromChat(repository, botActorFromRequest(req), req.body?.comments)
      res.json({
        ...result,
        workflow: result.workflow ? publicWorkflow(result.workflow) : undefined
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/resume/workflows/:workflowId/advance', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflowId = Number(req.params.workflowId)
      if (!Number.isFinite(workflowId) || workflowId <= 0) {
        res.status(400).json({ error: 'invalid_workflow_id' })
        return
      }
      const result = await resumeWorkflowById(workflowId, repository, {
        actor: botActorFromRequest(req),
        expectedStatus: req.body?.expectedStatus
      })
      const notificationWarnings = await sendResumeNotifications(result)
      res.status(result.found ? 200 : 404).json(publicResumeResult(result, { notificationWarnings }))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/bot/telegram/resume/workflows/:workflowId/reject', requireBotApiToken, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workflowId = Number(req.params.workflowId)
      if (!Number.isFinite(workflowId) || workflowId <= 0) {
        res.status(400).json({ error: 'invalid_workflow_id' })
        return
      }
      const result = await rejectResumeWorkflowById(workflowId, repository, {
        actor: botActorFromRequest(req),
        expectedStatus: req.body?.expectedStatus,
        rejectionComment: req.body?.comment
      })
      const notificationWarnings = await sendResumeNotifications(result)
      res.status(result.found ? 200 : 404).json(publicResumeResult(result, { notificationWarnings }))
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
    const boundary = requestAbortBoundary(req, res)
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.status(
        clientId,
        telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId),
        { signal: boundary.signal }
      ))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
    }
  })

  app.get('/api/telegram/dialogs', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const boundary = requestAbortBoundary(req, res)
    try {
      const clientId = telegramTargetClientId(req)
      const limit = Number(req.query?.limit)
      const folderId = Number(req.query?.folderId)
      res.json(await telegramService.dialogs(clientId, {
        accountId: telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId),
        list: String(req.query?.list ?? 'main').trim() || 'main',
        folderId: Number.isFinite(folderId) && folderId > 0 ? folderId : undefined,
        query: String(req.query?.query ?? '').trim() || undefined,
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        privateOnly: String(req.query?.privateOnly ?? '').trim().toLowerCase() === 'true',
        signal: boundary.signal
      }))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
    }
  })

  app.get('/api/telegram/folders', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const boundary = requestAbortBoundary(req, res)
    try {
      const clientId = telegramTargetClientId(req)
      res.json(await telegramService.folders(
        clientId,
        telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId),
        { signal: boundary.signal }
      ))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
    }
  })

  app.get('/api/telegram/messages', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const boundary = requestAbortBoundary(req, res)
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
        limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        signal: boundary.signal
      }))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
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
    const boundary = requestAbortBoundary(_req, res)
    try {
      res.json(await telegramService.listAdminSenders({ signal: boundary.signal }))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
    }
  })

  app.get('/api/admin/telegram/dialogs/scan', requireRole('admin'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const boundary = requestAbortBoundary(req, res)
    try {
      const clientId = Number(req.query?.targetClientId)
      const accountId = telegramAccountId(req.query?.platformAccountId ?? req.query?.accountId)
      const days = Number(req.query?.days ?? 1)
      if (!Number.isFinite(clientId) || clientId <= 0 || !accountId) {
        res.status(400).json({ error: 'missing_admin_telegram_dialog_scan_input' })
        return
      }
      if (!Number.isFinite(days) || days <= 0 || days > 3650) {
        res.status(400).json({ error: 'invalid_admin_telegram_dialog_days', message: 'Days must be greater than 0 and at most 3650.' })
        return
      }
      res.json(await telegramService.scanAdminDialogs(clientId, {
        accountId,
        days,
        signal: boundary.signal
      }))
    } catch (error) {
      next(error)
    } finally {
      boundary.dispose()
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

  app.post('/api/admin/cv-tailor/from-pdf', requireRole('admin'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const input = validateCvTailoringRequest(req.body)
      const result = await cvTailoringService.tailorFromPdf(input)
      res.json({
        url: result.url
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/admin/clients/:clientId/telegram/send', requireRole('admin'), async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const clientId = Number(req.params.clientId)
      if (!Number.isFinite(clientId) || clientId <= 0) {
        res.status(400).json({ success: false, error: 'INVALID_CLIENT_ID' })
        return
      }
      const client = await repository.getClientById(clientId)
      const chatId = String(client.commonChatId ?? '').trim()
      if (!chatId) {
        res.status(400).json({ success: false, error: 'CLIENT_HAS_NO_TELEGRAM_CHAT_ID' })
        return
      }
      const text = validateTelegramMessage(req.body?.text)
      await telegramBotApi.sendMessage({ chatId, text })
      res.json({
        success: true,
        sentTo: {
          clientId: client.id,
          clientName: client.clientName,
          chatId
        }
      })
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
    if ((error as any)?.code === 'invalid_google_folder' || (error as any)?.code === 'telegram_message_too_long') {
      res.status(400).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (
      (error as any)?.code === 'cv_tailoring_missing_job_requirements' ||
      (error as any)?.code === 'cv_tailoring_missing_pdf' ||
      (error as any)?.code === 'cv_tailoring_invalid_pdf'
    ) {
      res.status(400).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'cv_tailoring_api_failed') {
      res.status(502).json({
        error: (error as any).code,
        message: error instanceof Error ? error.message : String(error),
        status: (error as any).status
      })
      return
    }
    if ((error as any)?.code === 'cv_tailoring_not_configured') {
      res.status(503).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'resume_reset_test_disabled') {
      res.status(403).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'resume_required_data_missing') {
      res.status(422).json({
        error: (error as any).code,
        message: error instanceof Error ? error.message : String(error),
        missingFields: (error as any).missingFields ?? []
      })
      return
    }
    if ((error as any)?.code === 'resume_reject_comment_too_short') {
      res.status(400).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if (
      (error as any)?.code === 'resume_workflow_stale_status' ||
      (error as any)?.code === 'resume_workflow_noop' ||
      (error as any)?.code === 'resume_workflow_stopped' ||
      (error as any)?.code === 'resume_reject_not_allowed'
    ) {
      res.status(409).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'resume_workflow_failed') {
      res.status(500).json({ error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
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
    if ((error as any)?.code === 'telegram_bot_token_missing') {
      res.status(503).json({ success: false, error: (error as any).code, message: error instanceof Error ? error.message : String(error) })
      return
    }
    if ((error as any)?.code === 'telegram_bot_api_failed') {
      res.status(502).json({ success: false, error: 'TELEGRAM_SEND_FAILED', message: error instanceof Error ? error.message : String(error) })
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
    if (String((error as any)?.code || '').startsWith('telegram_gateway_')) {
      const failure = safeGatewayFailure(error)
      res.status(failure.statusCode).json(failure.body)
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
