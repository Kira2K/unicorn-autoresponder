require('dotenv').config({ quiet: true })

const crypto = require('node:crypto')
const { createWebConsoleApp } = require('../../features/web-console/backend/app.ts') as {
  createWebConsoleApp(options?: any): import('express').Express
}
const { createWebConsoleRepository } = require('../../features/web-console/backend/repository.ts') as {
  createWebConsoleRepository(options?: any): any
}
const { createTelegramService } = require('../../features/web-console/backend/telegram-service.ts') as {
  createTelegramService(options: any): any
}
const { createTelegramBotApi } = require('./bot-api.ts') as {
  createTelegramBotApi(options?: any): any
}
const { createDefaultTdlibAdapter } = require('./tdlib-client.ts') as {
  createDefaultTdlibAdapter(): any
}
const { createSupportBotApiClient, runSupportBot } = require('./support-bot.ts') as {
  createSupportBotApiClient(options?: any): any
  runSupportBot(options?: any): Promise<void>
}

type VisibleResumeE2eConfig = {
  testClientId: number
  testChatId: string
  studentAccountId: number
  providerAccountRef: string
  kiraUserId: string
  kiraUsername: string
  providerUserId: string
  providerUsername: string
}

type VisibleResumeE2eStep = {
  step: string
  status?: string
  command?: string
  commandEvidence?: 'tdlib_history' | 'bot_update'
  replyMatched?: string
  promptMatched?: string
  notificationWarnings?: string[]
}

type VisibleResumeE2eOptions = {
  repository?: any
  telegramService?: any
  botApi?: any
  config?: Partial<VisibleResumeE2eConfig>
  googleFolder?: string
  pollTimeout?: number
  pollIntervalMs?: number
  waitTimeoutMs?: number
  skipBotPreflight?: boolean
  proxyResolver?: any
  summaryLogsChannelId?: string
}

const DEFAULT_VISIBLE_RESUME_E2E_CONFIG: VisibleResumeE2eConfig = {
  testClientId: 102,
  testChatId: '-5216637594',
  studentAccountId: 473,
  providerAccountRef: '102:473',
  kiraUserId: '7586552066',
  kiraUsername: 'Kira_arbeitet',
  providerUserId: '8222949251',
  providerUsername: 'veu_support'
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function ensureRuntimeEnv(config: VisibleResumeE2eConfig): string {
  process.env.RESUME_WORKFLOW_TEST_MODE = 'true'
  process.env.RESUME_WORKFLOW_FAKE_DATA_MODE = 'true'
  process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS =
    process.env.RESUME_WORKFLOW_PROVIDER_TELEGRAM_USER_IDS || config.providerUserId
  process.env.RESUME_WORKFLOW_PROVIDER_PLATFORM_ACCOUNT_REFS = config.providerAccountRef
  process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID =
    process.env.RESUME_WORKFLOW_PROVIDER_NOTIFY_CHAT_ID || config.providerUserId
  process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS =
    process.env.RESUME_WORKFLOW_KIRA_TELEGRAM_USER_IDS || config.kiraUserId
  process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID =
    process.env.RESUME_WORKFLOW_KIRA_NOTIFY_CHAT_ID || config.kiraUserId
  process.env.WEB_CONSOLE_BOT_API_TOKEN =
    process.env.WEB_CONSOLE_BOT_API_TOKEN || crypto.randomBytes(24).toString('hex')
  addStudentUserIdMapping(config.testClientId, config.providerUserId)
  return String(process.env.WEB_CONSOLE_BOT_API_TOKEN)
}

function addStudentUserIdMapping(clientId: number, userId: string): void {
  const normalizedUserId = normalizeText(userId)
  if (!normalizedUserId) return
  const nextPair = `${clientId}:${normalizedUserId}`
  const existing = normalizeText(process.env.RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  if (!existing.includes(nextPair)) {
    process.env.RESUME_WORKFLOW_STUDENT_USER_IDS_BY_CLIENT = [...existing, nextPair].join(',')
  }
}

function createNoopSupportBotApiClient(): any {
  const fail = async () => {
    throw new Error('The visible e2e discovery bot can only answer local bot commands.')
  }
  return {
    findClient: fail,
    updateGoogleFolder: fail,
    resume: fail,
    resumeStatus: fail,
    resumeResetTest: fail,
    providerTasks: fail,
    providerTask: fail,
    advanceWorkflow: fail
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function errorText(error: any): string {
  return [
    error?.message,
    error?.response?.status,
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.body?.message,
    error?.body?.error
  ].filter(Boolean).join(' ')
}

function isTransientRateLimit(error: any): boolean {
  const status = Number(error?.response?.status ?? error?.status ?? error?.body?.status)
  const text = errorText(error)
  return status === 429 || /429|too many requests/i.test(text)
}

async function retryTransient<T>(label: string, action: () => Promise<T>): Promise<T> {
  const delays = [0, 5000, 10000, 20000, 30000]
  let lastError: any
  for (const delay of delays) {
    if (delay) await wait(delay)
    try {
      return await action()
    } catch (error: any) {
      lastError = error
      if (!isTransientRateLimit(error)) throw error
    }
  }
  throw Object.assign(lastError ?? new Error(`${label} failed after transient retries.`), { label })
}

function createObservedBotApi(botApi: any): { botApi: any; updates: any[]; sends: any[] } {
  const updates: any[] = []
  const sends: any[] = []
  return {
    updates,
    sends,
    botApi: {
      async getUpdates(offset?: number, timeout?: number) {
        const result = await botApi.getUpdates(offset, timeout)
        updates.push(...result)
        return result
      },
      async sendMessage(input: any) {
        const result = await botApi.sendMessage(input)
        sends.push({
          chatId: normalizeChatId(input?.chatId),
          text: normalizeText(input?.text),
          result,
          at: new Date().toISOString()
        })
        return result
      },
      async answerCallbackQuery(input: any) {
        return await botApi.answerCallbackQuery(input)
      }
    }
  }
}

async function listen(app: import('express').Express): Promise<{ baseUrl: string; close(): Promise<void> }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as import('node:net').AddressInfo
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((done, fail) => {
          let settled = false
          const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            error ? fail(error) : done()
          }
          const timer = setTimeout(() => {
            ;(server as any).closeAllConnections?.()
            ;(server as any).closeIdleConnections?.()
            finish()
          }, 5000)
          server.close(error => error ? finish(error) : finish())
          ;(server as any).closeIdleConnections?.()
        })
      })
    })
    server.on('error', reject)
  })
}

async function stopBotRunner(controller: AbortController, runner: Promise<void>): Promise<void> {
  controller.abort()
  await Promise.race([
    runner.catch(() => undefined),
    wait(5000)
  ])
}

async function requestJson(baseUrl: string, path: string, options: any = {}): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw Object.assign(new Error(`${options.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`), {
      status: response.status,
      body
    })
  }
  return body
}

function botHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Bot-Api-Token': token,
    ...extra
  }
}

function studentActorHeaders(config: VisibleResumeE2eConfig, token: string): Record<string, string> {
  return botHeaders(token, {
    'X-Telegram-User-Id': config.kiraUserId,
    'X-Telegram-Username': config.kiraUsername,
    'X-Telegram-Chat-Id': config.testChatId,
    'X-Telegram-Chat-Type': 'supergroup'
  })
}

function kiraActorHeaders(config: VisibleResumeE2eConfig, token: string): Record<string, string> {
  return botHeaders(token, {
    'X-Telegram-User-Id': config.kiraUserId,
    'X-Telegram-Username': config.kiraUsername,
    'X-Telegram-Chat-Id': config.kiraUserId,
    'X-Telegram-Chat-Type': 'private'
  })
}

function providerActorHeaders(config: VisibleResumeE2eConfig, token: string): Record<string, string> {
  return botHeaders(token, {
    'X-Telegram-User-Id': config.providerUserId,
    'X-Telegram-Username': config.providerUsername,
    'X-Telegram-Chat-Id': config.providerUserId,
    'X-Telegram-Chat-Type': 'private'
  })
}

async function ensureTestClientData(repository: any, config: VisibleResumeE2eConfig): Promise<string[]> {
  const setup: string[] = []
  let client = await repository.getClientById(config.testClientId)

  if (!normalizeText(client.education)) {
    await repository.updateClientProfile(config.testClientId, {
      education: 'Test education for visible resume e2e'
    })
    setup.push('Education was missing and was set to a test value.')
    client = await repository.getClientById(config.testClientId)
  } else {
    setup.push('Education already set.')
  }

  if (!client.englishLevelId) {
    const levels = await repository.listEnglishLevels()
    const b1 = levels.find((level: any) => normalizeText(level.label).toLowerCase() === 'b1') || levels[0]
    if (!b1) throw new Error('No English level options exist in NocoDB.')
    await repository.updateClientProfile(config.testClientId, { englishLevelId: Number(b1.id) })
    setup.push(`English level was missing and was set to ${b1.label} (${b1.id}).`)
  } else {
    setup.push(`English level already set: ${client.englishLevel || client.englishLevelId}.`)
  }

  return setup
}

async function resetWorkflow(repository: any, config: VisibleResumeE2eConfig): Promise<any> {
  const workflow = await repository.getResumeWorkflowByTelegramChatId(config.testChatId, { ensure: true })
  if (!workflow) throw new Error(`CV workflow for chat ${config.testChatId} was not found.`)
  return await repository.patchResumeWorkflow(workflow.id, {
    status: "collection student's data",
    studentDataFolderUrl: '',
    cvDraftUrl: '',
    enVersionUrl: '',
    ruVersionUrl: '',
    additionalVersions: '',
    kirasComments: '',
    lastResponsible: 'student',
    lastWorkflowError: '',
    workflowTrace: `visible resume e2e reset ${new Date().toISOString()}`
  })
}

async function newestUpdateOffset(botApi: any): Promise<number> {
  const updates = await botApi.getUpdates(undefined, 0)
  const maxUpdateId = Math.max(0, ...updates.map((update: any) => Number(update.update_id)).filter(Number.isFinite))
  return maxUpdateId ? maxUpdateId + 1 : 0
}

function newestObservedUpdateId(updates: any[]): number {
  return Math.max(0, ...updates.map(update => Number(update.update_id)).filter(Number.isFinite))
}

async function getMessages(telegramService: any, config: VisibleResumeE2eConfig, limit = 80): Promise<any[]> {
  const result = await telegramService.messages(config.testClientId, {
    accountId: config.studentAccountId,
    chatId: config.testChatId,
    limit
  })
  return result.messages || []
}

async function getMessageIdSet(telegramService: any, config: VisibleResumeE2eConfig): Promise<Set<string>> {
  return new Set((await getMessages(telegramService, config)).map(message => String(message.id)))
}

function isNewMessage(message: any, baselineIds?: Set<string>): boolean {
  return !baselineIds || !baselineIds.has(String(message.id))
}

function hasOutgoing(messages: any[], command: string, baselineIds?: Set<string>): boolean {
  return messages.some(message => isNewMessage(message, baselineIds) && message.outgoing && normalizeText(message.text) === command)
}

function normalizeChatId(value: unknown): string {
  return String(value ?? '').trim()
}

function findObservedCommandUpdate(input: {
  updates: any[]
  command: string
  chatId: string
  afterUpdateId: number
  userId?: string
}): any | undefined {
  const expectedChatId = normalizeChatId(input.chatId)
  const expectedUserId = normalizeText(input.userId)
  return input.updates.find(update => {
    const updateId = Number(update?.update_id)
    if (!Number.isFinite(updateId) || updateId <= input.afterUpdateId) return false
    const message = update?.message
    if (normalizeText(message?.text) !== input.command) return false
    if (normalizeChatId(message?.chat?.id) !== expectedChatId) return false
    if (expectedUserId && normalizeText(message?.from?.id) !== expectedUserId) return false
    return true
  })
}

function findObservedBotSend(input: {
  sends: any[]
  chatId: string
  expected: string | RegExp
  afterIndex: number
}): string {
  const expectedChatId = normalizeChatId(input.chatId)
  const match = input.sends.slice(input.afterIndex).find(send => {
    if (normalizeChatId(send?.chatId) !== expectedChatId) return false
    const text = normalizeText(send?.text)
    return input.expected instanceof RegExp ? input.expected.test(text) : text.includes(input.expected)
  })
  return normalizeText(match?.text)
}

function findIncomingText(messages: any[], expected: string | RegExp, baselineIds?: Set<string>): string {
  const match = messages.find(message => {
    if (!isNewMessage(message, baselineIds)) return false
    if (message.outgoing) return false
    const text = normalizeText(message.text)
    return expected instanceof RegExp ? expected.test(text) : text.includes(expected)
  })
  return normalizeText(match?.text)
}

async function waitForEvidence(input: {
  repository: any
  telegramService: any
  config: VisibleResumeE2eConfig
  expectedStatus?: string
  command?: string
  reply?: string | RegExp
  baselineIds?: Set<string>
  observedUpdates?: any[]
  observedSends?: any[]
  baselineUpdateId?: number
  baselineSendIndex?: number
  studentUserId?: string
  pollIntervalMs: number
  timeoutMs: number
}): Promise<{ status: string; commandEvidence?: 'tdlib_history' | 'bot_update'; replyMatched?: string }> {
  const started = Date.now()
  let lastStatus = ''
  let lastTexts = ''
  let lastUpdateSummary = ''
  let lastSendSummary = ''
  let lastTransient = ''
  while (Date.now() - started < input.timeoutMs) {
    let workflow: any
    let messages: any[]
    try {
      ;[workflow, messages] = await Promise.all([
        input.repository.getResumeWorkflowByTelegramChatId(input.config.testChatId, { ensure: true }),
        getMessages(input.telegramService, input.config)
      ])
      lastTransient = ''
    } catch (error: any) {
      if (!isTransientRateLimit(error)) throw error
      lastTransient = errorText(error)
      await wait(input.pollIntervalMs)
      continue
    }
    lastStatus = normalizeText(workflow?.status)
    lastTexts = messages.slice(-8).map(message => `${message.outgoing ? 'out' : 'in'}:${message.text}`).join(' | ')
    const outgoingCommandSeen = Boolean(input.command && hasOutgoing(messages, input.command, input.baselineIds))
    const updateCommandSeen = Boolean(input.command && findObservedCommandUpdate({
      updates: input.observedUpdates || [],
      command: input.command,
      chatId: input.config.testChatId,
      afterUpdateId: Number(input.baselineUpdateId || 0),
      userId: input.studentUserId
    }))
    lastUpdateSummary = (input.observedUpdates || [])
      .filter(update => Number(update?.update_id) > Number(input.baselineUpdateId || 0))
      .slice(-5)
      .map(update => `${update.update_id}:${update.message?.chat?.id}:${update.message?.from?.id}:${update.message?.text}`)
      .join(' | ')
    lastSendSummary = (input.observedSends || [])
      .slice(Number(input.baselineSendIndex || 0))
      .slice(-5)
      .map(send => `${send.chatId}:${send.text}`)
      .join(' | ')
    const commandOk = !input.command || outgoingCommandSeen || updateCommandSeen
    const replyText = input.reply
      ? findIncomingText(messages, input.reply, input.baselineIds) || findObservedBotSend({
        sends: input.observedSends || [],
        chatId: input.config.testChatId,
        expected: input.reply,
        afterIndex: Number(input.baselineSendIndex || 0)
      })
      : ''
    const replyOk = !input.reply || Boolean(replyText)
    const statusOk = !input.expectedStatus || lastStatus === input.expectedStatus
    const warningOk = !normalizeText(workflow?.lastWorkflowError).includes('Notification warning')
    if (commandOk && replyOk && statusOk && warningOk) {
      return {
        status: lastStatus,
        commandEvidence: input.command ? (outgoingCommandSeen ? 'tdlib_history' : 'bot_update') : undefined,
        replyMatched: replyText || undefined
      }
    }
    await wait(input.pollIntervalMs)
  }
  throw new Error(
    `Timed out waiting for visible chat evidence. Expected status=${input.expectedStatus || 'any'}, command=${input.command || 'none'}, reply=${String(input.reply || 'none')}. Last status=${lastStatus}. Last messages=${lastTexts}. Last bot updates=${lastUpdateSummary}. Last bot sends=${lastSendSummary}. Last transient=${lastTransient}`
  )
}

async function sendStudentCommand(input: {
  repository: any
  telegramService: any
  config: VisibleResumeE2eConfig
  command: string
  expectedStatus?: string
  reply: string | RegExp
  observedUpdates?: any[]
  observedSends?: any[]
  studentUserId?: string
  pollIntervalMs: number
  timeoutMs: number
}): Promise<VisibleResumeE2eStep> {
  const baselineIds = await retryTransient('message baseline', () => getMessageIdSet(input.telegramService, input.config))
  const baselineUpdateId = newestObservedUpdateId(input.observedUpdates || [])
  const baselineSendIndex = input.observedSends?.length ?? 0
  await retryTransient(`send ${input.command}`, () => input.telegramService.send(input.config.testClientId, {
    accountId: input.config.studentAccountId,
    chatId: input.config.testChatId,
    text: input.command,
    allowWrite: true
  }))
  const evidence = await waitForEvidence({
    repository: input.repository,
    telegramService: input.telegramService,
    config: input.config,
    expectedStatus: input.expectedStatus,
    command: input.command,
    reply: input.reply,
    baselineIds,
    observedUpdates: input.observedUpdates,
    observedSends: input.observedSends,
    baselineUpdateId,
    baselineSendIndex,
    studentUserId: input.studentUserId,
    pollIntervalMs: input.pollIntervalMs,
    timeoutMs: input.timeoutMs
  })
  return {
    step: input.command.split(/\s+/)[0],
    command: input.command,
    status: evidence.status,
    commandEvidence: evidence.commandEvidence,
    replyMatched: evidence.replyMatched
  }
}

async function discoverStudentActor(input: {
  repository: any
  telegramService: any
  config: VisibleResumeE2eConfig
  observedUpdates?: any[]
  observedSends?: any[]
  pollIntervalMs: number
  timeoutMs: number
}): Promise<VisibleResumeE2eStep & { userId?: string; username?: string }> {
  const step = await sendStudentCommand({
    repository: input.repository,
    telegramService: input.telegramService,
    config: input.config,
    command: '/whoami',
    reply: /User ID:/i,
    observedUpdates: input.observedUpdates,
    observedSends: input.observedSends,
    pollIntervalMs: input.pollIntervalMs,
    timeoutMs: input.timeoutMs
  })
  const text = step.replyMatched || ''
  const userId = text.match(/User ID:\s*([^\s]+)/i)?.[1]
  const username = text.match(/Username:\s*@?([A-Za-z0-9_]+)/i)?.[1]
  if (!userId || !/^\d+$/.test(userId)) {
    throw new Error(`Could not discover numeric student Telegram user id from /whoami reply: ${text}`)
  }
  addStudentUserIdMapping(input.config.testClientId, userId)
  const workflow = await input.repository.getResumeWorkflowByTelegramChatId(input.config.testChatId, { ensure: true })
  const workflowClientId = Number(workflow?.clientId)
  if (Number.isFinite(workflowClientId) && workflowClientId > 0) {
    addStudentUserIdMapping(workflowClientId, userId)
  }
  return {
    ...step,
    step: 'discover_student_actor',
    userId,
    username
  }
}

function assertNoWarnings(label: string, result: any): void {
  const warnings = Array.isArray(result?.notificationWarnings) ? result.notificationWarnings : []
  if (warnings.length) {
    throw new Error(`${label} produced notification warnings: ${warnings.join('; ')}`)
  }
}

async function advanceKira(input: {
  baseUrl: string
  token: string
  config: VisibleResumeE2eConfig
  expectedStatus: string
  nextStatus: string
}): Promise<VisibleResumeE2eStep> {
  const result = await retryTransient(`Kira step ${input.expectedStatus}`, () => requestJson(input.baseUrl, `/api/bot/telegram/chats/${encodeURIComponent(input.config.testChatId)}/resume`, {
    method: 'POST',
    headers: kiraActorHeaders(input.config, input.token),
    body: JSON.stringify({ expectedStatus: input.expectedStatus })
  }))
  assertNoWarnings(`Kira step ${input.expectedStatus}`, result)
  if (result.workflow?.status !== input.nextStatus) {
    throw new Error(`Kira step expected ${input.nextStatus}, got ${result.workflow?.status}`)
  }
  return {
    step: `kira:${input.expectedStatus}`,
    status: result.workflow.status,
    notificationWarnings: []
  }
}

async function providerTasks(input: {
  baseUrl: string
  token: string
  config: VisibleResumeE2eConfig
}): Promise<any[]> {
  const result = await retryTransient('provider tasks', () => requestJson(input.baseUrl, '/api/bot/telegram/resume/provider/tasks', {
    headers: providerActorHeaders(input.config, input.token)
  }))
  const tasks = result.tasks || []
  if (tasks.length !== 1 || Number(tasks[0].clientId) !== Number(input.config.testClientId)) {
    throw new Error(`Provider task filter failed. Expected only client ${input.config.testClientId}, got ${JSON.stringify(tasks)}`)
  }
  return tasks
}

async function advanceProvider(input: {
  baseUrl: string
  token: string
  config: VisibleResumeE2eConfig
  workflowId: number
  expectedStatus: string
  nextStatus: string
}): Promise<VisibleResumeE2eStep> {
  const result = await retryTransient(`Provider step ${input.expectedStatus}`, () => requestJson(input.baseUrl, `/api/bot/telegram/resume/workflows/${input.workflowId}/advance`, {
    method: 'POST',
    headers: providerActorHeaders(input.config, input.token),
    body: JSON.stringify({ expectedStatus: input.expectedStatus })
  }))
  assertNoWarnings(`Provider step ${input.expectedStatus}`, result)
  if (result.workflow?.status !== input.nextStatus) {
    throw new Error(`Provider step expected ${input.nextStatus}, got ${result.workflow?.status}`)
  }
  return {
    step: `provider:${input.expectedStatus}`,
    status: result.workflow.status,
    notificationWarnings: []
  }
}

async function waitForStudentPrompt(input: {
  telegramService: any
  config: VisibleResumeE2eConfig
  status: string
  baselineIds?: Set<string>
  observedSends?: any[]
  baselineSendIndex?: number
  pollIntervalMs: number
  timeoutMs: number
}): Promise<string> {
  const started = Date.now()
  let lastTransient = ''
  while (Date.now() - started < input.timeoutMs) {
    let messages: any[]
    try {
      messages = await getMessages(input.telegramService, input.config)
      lastTransient = ''
    } catch (error: any) {
      if (!isTransientRateLimit(error)) throw error
      lastTransient = errorText(error)
      await wait(input.pollIntervalMs)
      continue
    }
    const prompt = findIncomingText(
      messages,
      new RegExp(`@?${input.config.kiraUsername}.*${input.status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      input.baselineIds
    ) || findObservedBotSend({
      sends: input.observedSends || [],
      chatId: input.config.testChatId,
      expected: new RegExp(`@?${input.config.kiraUsername}.*${input.status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      afterIndex: Number(input.baselineSendIndex || 0)
    })
    if (prompt) return prompt
    await wait(input.pollIntervalMs)
  }
  throw new Error(`Timed out waiting for student-facing common-chat prompt for "${input.status}". Last transient=${lastTransient}`)
}

async function runVisibleResumeE2e(options: VisibleResumeE2eOptions = {}) {
  const config: VisibleResumeE2eConfig = {
    ...DEFAULT_VISIBLE_RESUME_E2E_CONFIG,
    ...(options.config || {})
  }
  const token = ensureRuntimeEnv(config)
  const repository = options.repository ?? createWebConsoleRepository()
  const rawBotApi = options.botApi ?? createTelegramBotApi()
  const observed = createObservedBotApi(rawBotApi)
  const botApi = observed.botApi
  const ownedTelegramAdapter = options.telegramService ? null : createDefaultTdlibAdapter()
  const telegramService = options.telegramService ?? createTelegramService({
    repository,
    adapter: ownedTelegramAdapter,
    ...(options.proxyResolver ? { proxyResolver: options.proxyResolver } : {})
  })
  const googleFolder = options.googleFolder || `https://drive.google.com/drive/folders/visible-resume-e2e-${Date.now()}`
  const waitTimeoutMs = Number(options.waitTimeoutMs ?? 180000)
  const pollIntervalMs = Number(options.pollIntervalMs ?? 3000)
  const setup = await retryTransient('ensure test client data', () => ensureTestClientData(repository, config))
  const reset = await retryTransient('reset workflow', () => resetWorkflow(repository, config))
  const initialOffset = options.skipBotPreflight ? 0 : await newestUpdateOffset(botApi)
  const steps: VisibleResumeE2eStep[] = []

  const discoveryController = new AbortController()
  const discoveryRunner = runSupportBot({
    botApi,
    apiClient: createNoopSupportBotApiClient(),
    initialOffset,
    pollTimeout: Number(options.pollTimeout ?? 2),
    idleDelayMs: 100,
    stopSignal: discoveryController.signal
  })

  try {
    steps.push(await discoverStudentActor({
      repository,
      telegramService,
      config,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))
  } finally {
    await stopBotRunner(discoveryController, discoveryRunner)
  }

  const appInitialOffset = Math.max(initialOffset, newestObservedUpdateId(observed.updates) + 1)
  const app = createWebConsoleApp({
    repository,
    telegramBotApi: botApi,
    ...(options.summaryLogsChannelId !== undefined ? { summaryLogsChannelId: options.summaryLogsChannelId } : {})
  })
  const server = await listen(app)
  const controller = new AbortController()
  const botRunner = runSupportBot({
    botApi,
    apiClient: createSupportBotApiClient({ baseUrl: server.baseUrl, token }),
    initialOffset: appInitialOffset,
    pollTimeout: Number(options.pollTimeout ?? 2),
    idleDelayMs: 100,
    stopSignal: controller.signal
  })

  try {
    const discoveredStudentUserId = String((steps[steps.length - 1] as any).userId || '')

    steps.push(await sendStudentCommand({
      repository,
      telegramService,
      config,
      command: `/change_google_folder ${googleFolder}`,
      expectedStatus: "collection student's data",
      reply: /Google folder updated/i,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      studentUserId: discoveredStudentUserId,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))

    steps.push(await sendStudentCommand({
      repository,
      telegramService,
      config,
      command: '/resume',
      expectedStatus: "collection Kira's comments",
      reply: /collection Kira's comments/i,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      studentUserId: discoveredStudentUserId,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))

    steps.push(await advanceKira({
      baseUrl: server.baseUrl,
      token,
      config,
      expectedStatus: "collection Kira's comments",
      nextStatus: 'Draft in process'
    }))
    const tasks = await providerTasks({ baseUrl: server.baseUrl, token, config })
    const workflowId = Number(tasks[0].id)
    steps.push({ step: 'provider_tasks', status: tasks[0].status })
    steps.push(await advanceProvider({
      baseUrl: server.baseUrl,
      token,
      config,
      workflowId,
      expectedStatus: 'Draft in process',
      nextStatus: 'Draft in approve by Kira'
    }))
    const draftPromptBaseline = await retryTransient('draft prompt baseline', () => getMessageIdSet(telegramService, config))
    const draftPromptSendBaseline = observed.sends.length
    steps.push(await advanceKira({
      baseUrl: server.baseUrl,
      token,
      config,
      expectedStatus: 'Draft in approve by Kira',
      nextStatus: 'Draft in approve by student'
    }))
    steps.push({
      step: 'student_prompt:draft',
      status: 'Draft in approve by student',
      promptMatched: await waitForStudentPrompt({
        telegramService,
        config,
        status: 'Draft in approve by student',
        baselineIds: draftPromptBaseline,
        observedSends: observed.sends,
        baselineSendIndex: draftPromptSendBaseline,
        pollIntervalMs,
        timeoutMs: waitTimeoutMs
      })
    })

    steps.push(await sendStudentCommand({
      repository,
      telegramService,
      config,
      command: '/resume',
      expectedStatus: 'English version in progress',
      reply: /English version in progress/i,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      studentUserId: discoveredStudentUserId,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))
    steps.push(await advanceProvider({
      baseUrl: server.baseUrl,
      token,
      config,
      workflowId,
      expectedStatus: 'English version in progress',
      nextStatus: 'English version in approve by Kira'
    }))
    const englishPromptBaseline = await retryTransient('english prompt baseline', () => getMessageIdSet(telegramService, config))
    const englishPromptSendBaseline = observed.sends.length
    steps.push(await advanceKira({
      baseUrl: server.baseUrl,
      token,
      config,
      expectedStatus: 'English version in approve by Kira',
      nextStatus: 'English version in approve by student'
    }))
    steps.push({
      step: 'student_prompt:english',
      status: 'English version in approve by student',
      promptMatched: await waitForStudentPrompt({
        telegramService,
        config,
        status: 'English version in approve by student',
        baselineIds: englishPromptBaseline,
        observedSends: observed.sends,
        baselineSendIndex: englishPromptSendBaseline,
        pollIntervalMs,
        timeoutMs: waitTimeoutMs
      })
    })

    steps.push(await sendStudentCommand({
      repository,
      telegramService,
      config,
      command: '/resume',
      expectedStatus: 'Russian version in process',
      reply: /Russian version in process/i,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      studentUserId: discoveredStudentUserId,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))
    steps.push(await advanceProvider({
      baseUrl: server.baseUrl,
      token,
      config,
      workflowId,
      expectedStatus: 'Russian version in process',
      nextStatus: 'Russian version in approve by Kira'
    }))
    const russianPromptBaseline = await retryTransient('russian prompt baseline', () => getMessageIdSet(telegramService, config))
    const russianPromptSendBaseline = observed.sends.length
    steps.push(await advanceKira({
      baseUrl: server.baseUrl,
      token,
      config,
      expectedStatus: 'Russian version in approve by Kira',
      nextStatus: 'Russian version in approve by student'
    }))
    steps.push({
      step: 'student_prompt:russian',
      status: 'Russian version in approve by student',
      promptMatched: await waitForStudentPrompt({
        telegramService,
        config,
        status: 'Russian version in approve by student',
        baselineIds: russianPromptBaseline,
        observedSends: observed.sends,
        baselineSendIndex: russianPromptSendBaseline,
        pollIntervalMs,
        timeoutMs: waitTimeoutMs
      })
    })

    steps.push(await sendStudentCommand({
      repository,
      telegramService,
      config,
      command: '/resume',
      expectedStatus: 'moved to filling',
      reply: /moved to filling/i,
      observedUpdates: observed.updates,
      observedSends: observed.sends,
      studentUserId: discoveredStudentUserId,
      pollIntervalMs,
      timeoutMs: waitTimeoutMs
    }))
    steps.push(await advanceProvider({
      baseUrl: server.baseUrl,
      token,
      config,
      workflowId,
      expectedStatus: 'moved to filling',
      nextStatus: 'filled'
    }))

    const finalWorkflow: any = await retryTransient('final workflow read', () => repository.getResumeWorkflowByTelegramChatId(config.testChatId, { ensure: true }))
    if (finalWorkflow.status !== 'filled') throw new Error(`Final status is ${finalWorkflow.status}, expected filled.`)
    if (finalWorkflow.studentDataFolderUrl !== googleFolder) {
      throw new Error(`Final student_data_folder_url mismatch. Expected ${googleFolder}, got ${finalWorkflow.studentDataFolderUrl}`)
    }
    if (!finalWorkflow.cvDraftUrl || !finalWorkflow.enVersionUrl || !finalWorkflow.ruVersionUrl) {
      throw new Error('Final workflow links are incomplete.')
    }
    if (normalizeText(finalWorkflow.lastWorkflowError).includes('Notification warning')) {
      throw new Error(`Final workflow has notification warning: ${finalWorkflow.lastWorkflowError}`)
    }

    return {
      ok: true,
      setup,
      config,
      googleFolder,
      resetWorkflowId: reset.id,
      steps,
      final: {
        status: finalWorkflow.status,
        studentDataFolderUrl: finalWorkflow.studentDataFolderUrl,
        cvDraftUrl: finalWorkflow.cvDraftUrl,
        enVersionUrl: finalWorkflow.enVersionUrl,
        ruVersionUrl: finalWorkflow.ruVersionUrl,
        lastWorkflowError: finalWorkflow.lastWorkflowError
      }
    }
  } finally {
    await stopBotRunner(controller, botRunner)
    await ownedTelegramAdapter?.close?.({
      clientId: config.testClientId,
      accountId: config.studentAccountId
    }).catch(() => undefined)
    await server.close()
  }
}

if (require.main === module) {
  runVisibleResumeE2e()
    .then((result: any) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: any) => {
      console.error(JSON.stringify({
        ok: false,
        message: error?.message || String(error),
        code: error?.code,
        body: error?.body
      }, null, 2))
      process.exit(1)
    })
}

module.exports = {
  DEFAULT_VISIBLE_RESUME_E2E_CONFIG,
  runVisibleResumeE2e
}
