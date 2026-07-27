require('dotenv').config()

const { createTelegramBotApi } = require('./bot-api.ts') as {
  createTelegramBotApi(options?: any): {
    getUpdates(offset?: number, timeout?: number, allowedUpdates?: string[]): Promise<any[]>
    sendMessage(input: { chatId: string; text: string; messageThreadId?: number; replyMarkup?: unknown; parseMode?: string }): Promise<unknown>
    answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<unknown>
  }
}

type SupportBotActor = {
  userId: string
  username: string
  chatId: string
  chatType: string
}

type SupportBotResponse = string | {
  text: string
  replyMarkup?: unknown
  parseMode?: string
}

type SupportBotApiClient = {
  backendStatus(): Promise<{ ok: boolean; service?: string; checkedAt?: string }>
  findClient(chatId: string, actor?: SupportBotActor): Promise<{ found: boolean; chatId: string; client?: { id: number; name: string; chatId: string; googleFolder: string } }>
  updateGoogleFolder(chatId: string, googleFolder: string, actor?: SupportBotActor): Promise<{ success: boolean; error?: string; chatId?: string; client?: { id: number; name: string; chatId: string; googleFolder: string } }>
  resume(chatId: string, actor?: SupportBotActor, options?: { studentDataFolderUrl?: string }): Promise<{ found: boolean; message: string }>
  resumeStatus(chatId: string, actor?: SupportBotActor): Promise<{ found: boolean; message: string }>
  resumeResetTest(chatId: string, actor?: SupportBotActor): Promise<{ found: boolean; message: string }>
  providerTasks(actor?: SupportBotActor, offset?: number): Promise<{ message: string; replyMarkup?: unknown }>
  providerTask(workflowId: number, actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown; workflow?: { id?: number; status?: string } }>
  advanceWorkflow(workflowId: number, expectedStatus: string, actor?: SupportBotActor): Promise<{ found: boolean; message: string; workflow?: { status?: string } }>
  saveKiraComments(comments: string, actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown }>
  saveResumeTaskInput(text: string, actor?: SupportBotActor, options?: { workflowId?: number; expectedStatus?: string }): Promise<{ message: string; replyMarkup?: unknown; workflow?: { id?: number; status?: string }; clearActiveTask?: boolean }>
}

const BACKEND_UNAVAILABLE_MESSAGE = 'Бэкенд сейчас недоступен. Попробуй позже.'
const BACKEND_OVERLOADED_MESSAGE = 'Бэкенд сейчас перегружен. Попробуй позже.'
const GENERIC_BOT_ERROR_MESSAGE = 'Команда Telegram-бота завершилась с ошибкой.'
const SUPPORT_BOT_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member']
const ACTIVE_TASK_CONTEXT_TTL_MS = 30 * 60 * 1000

type ActiveTaskContext = {
  workflowId: number
  expectedStatus: string
  openedAtMs: number
}

const activeTaskContexts = new Map<string, ActiveTaskContext>()

function normalizeCommandText(value: unknown): string {
  return String(value ?? '').trim()
}

function commandName(text: string): string {
  const first = text.split(/\s+/)[0] || ''
  return first.replace(/@[\w_]+$/, '').toLowerCase()
}

function commandArgument(text: string): string {
  return text.replace(/^\S+\s*/, '').trim()
}

function actorFromMessage(message: any): SupportBotActor {
  return {
    userId: String(message?.from?.id ?? '').trim(),
    username: String(message?.from?.username ?? '').trim(),
    chatId: String(message?.chat?.id ?? '').trim(),
    chatType: String(message?.chat?.type ?? 'unknown').trim()
  }
}

function actorFromCallbackQuery(callbackQuery: any): SupportBotActor {
  return {
    userId: String(callbackQuery?.from?.id ?? '').trim(),
    username: String(callbackQuery?.from?.username ?? '').trim(),
    chatId: String(callbackQuery?.message?.chat?.id ?? callbackQuery?.from?.id ?? '').trim(),
    chatType: String(callbackQuery?.message?.chat?.type ?? 'private').trim()
  }
}

function actorHeaders(actor?: SupportBotActor): Record<string, string> {
  if (!actor) return {}
  return {
    'X-Telegram-User-Id': actor.userId,
    'X-Telegram-Username': actor.username,
    'X-Telegram-Chat-Id': actor.chatId,
    'X-Telegram-Chat-Type': actor.chatType
  }
}

function activeTaskContextKey(actor: SupportBotActor): string {
  return [actor.chatType, actor.chatId, actor.userId].join(':')
}

function clearActiveTaskContext(actor: SupportBotActor): void {
  activeTaskContexts.delete(activeTaskContextKey(actor))
}

function clearActiveTaskContextsForTest(): void {
  activeTaskContexts.clear()
}

function rememberActiveTaskContext(actor: SupportBotActor, workflowId: number, expectedStatus = '', nowMs = Date.now()): void {
  if (actor.chatType !== 'private') return
  if (!Number.isFinite(workflowId) || workflowId <= 0) return
  activeTaskContexts.set(activeTaskContextKey(actor), {
    workflowId,
    expectedStatus,
    openedAtMs: nowMs
  })
}

function activeTaskContext(actor: SupportBotActor, nowMs = Date.now()): ActiveTaskContext | null {
  const key = activeTaskContextKey(actor)
  const context = activeTaskContexts.get(key)
  if (!context) return null
  if (nowMs - context.openedAtMs > ACTIVE_TASK_CONTEXT_TTL_MS) {
    activeTaskContexts.delete(key)
    return null
  }
  return context
}

const RESUME_STATUS_CALLBACK_STATUSES: Record<string, string> = {
  csd: "collection student's data",
  ckc: "collection Kira's comments",
  dip: 'Draft in process',
  dak: 'Draft in approve by Kira',
  das: 'Draft in approve by student',
  evp: 'English version in progress',
  eak: 'English version in approve by Kira',
  eas: 'English version in approve by student',
  rvp: 'Russian version in process',
  rak: 'Russian version in approve by Kira',
  ras: 'Russian version in approve by student',
  mtf: 'moved to filling',
  stp: 'stopped',
  fld: 'filled'
}

function decodeCallbackStatus(value: string | undefined): string {
  if (!value) return ''
  const normalized = normalizeCommandText(value)
  return RESUME_STATUS_CALLBACK_STATUSES[normalized] || Buffer.from(normalized, 'base64url').toString('utf8')
}

function responseText(response: SupportBotResponse): string {
  return typeof response === 'string' ? response : response.text
}

function backendUnavailableError(cause: unknown): Error & { code: string; cause?: unknown } {
  return Object.assign(new Error(BACKEND_UNAVAILABLE_MESSAGE), {
    code: 'backend_unavailable',
    cause
  })
}

function backendOverloadedError(cause: unknown): Error & { code: string; cause?: unknown } {
  return Object.assign(new Error(BACKEND_OVERLOADED_MESSAGE), {
    code: 'backend_overloaded',
    cause
  })
}

function backendRequestTimeoutMs(value: unknown = process.env.SUPPORT_BOT_BACKEND_TIMEOUT_MS): number {
  const timeoutMs = Number(value)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000
}

function isBackendOverloadedError(error: any): boolean {
  const code = String(error?.code ?? error?.cause?.code ?? error?.body?.error ?? '').trim()
  const status = Number(error?.status ?? error?.cause?.status ?? error?.body?.status)
  const message = String(error?.message ?? error?.cause?.message ?? '').toLowerCase()
  return (
    code === 'backend_overloaded' ||
    status === 429 ||
    message.includes('status code 429') ||
    message.includes('too many requests')
  )
}

function isBackendUnavailableError(error: any): boolean {
  const code = String(error?.code ?? error?.cause?.code ?? '').trim()
  const message = String(error?.message ?? '').toLowerCase()
  return (
    code === 'backend_unavailable' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code) ||
    error?.name === 'AbortError' ||
    message.includes('fetch failed') ||
    message.includes('failed to fetch') ||
    message.includes('connection refused')
  )
}

async function withBackendStatusMessage(action: () => Promise<SupportBotResponse>): Promise<SupportBotResponse> {
  try {
    return await action()
  } catch (error: any) {
    if (isBackendOverloadedError(error)) {
      return BACKEND_OVERLOADED_MESSAGE
    }
    if (isBackendUnavailableError(error)) {
      return BACKEND_UNAVAILABLE_MESSAGE
    }
    throw error
  }
}

function createSupportBotApiClient(options: {
  baseUrl?: string
  token?: string
  requester?: typeof fetch
  timeoutMs?: number
} = {}): SupportBotApiClient {
  const baseUrl = String(options.baseUrl ?? process.env.WEB_CONSOLE_BASE_URL ?? 'http://127.0.0.1:4300').replace(/\/+$/, '')
  const token = String(options.token ?? process.env.WEB_CONSOLE_BOT_API_TOKEN ?? '').trim()
  const requester = options.requester ?? fetch
  const timeoutMs = backendRequestTimeoutMs(options.timeoutMs)

  async function request(path: string, requestOptions: Record<string, unknown> = {}) {
    if (!token) {
      throw Object.assign(new Error('WEB_CONSOLE_BOT_API_TOKEN is not configured.'), { code: 'bot_api_token_missing' })
    }
    let response: Awaited<ReturnType<typeof requester>>
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      response = await requester(`${baseUrl}${path}`, {
        ...requestOptions,
        signal: (requestOptions as any).signal ?? controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Api-Token': token,
          ...((requestOptions.headers as Record<string, string>) ?? {})
        }
      } as any)
    } catch (error: any) {
      throw backendUnavailableError(error)
    } finally {
      clearTimeout(timeout)
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (response.status === 429) {
        throw backendOverloadedError({ status: response.status, body })
      }
      if ([502, 503, 504].includes(response.status)) {
        throw backendUnavailableError({ status: response.status, body })
      }
      throw Object.assign(new Error(body.message || body.error || `Bot API request failed: ${response.status}`), {
        code: body.error || 'bot_api_request_failed',
        status: response.status,
        body
      })
    }
    return body
  }

  return {
    async backendStatus() {
      return await request('/api/bot/status')
    },
    async findClient(chatId: string, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/client`, {
        headers: actorHeaders(actor)
      })
    },
    async updateGoogleFolder(chatId: string, googleFolder: string, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/google-folder`, {
        method: 'PATCH',
        headers: actorHeaders(actor),
        body: JSON.stringify({ googleFolder, actor })
      })
    },
    async resume(chatId: string, actor?: SupportBotActor, options: { studentDataFolderUrl?: string } = {}) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/resume`, {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({ actor, studentDataFolderUrl: options.studentDataFolderUrl })
      })
    },
    async resumeStatus(chatId: string, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/resume/status`, {
        headers: actorHeaders(actor)
      })
    },
    async resumeResetTest(chatId: string, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/resume/reset-test`, {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({ actor })
      })
    },
    async providerTasks(actor?: SupportBotActor, offset = 0) {
      const query = offset > 0 ? `?offset=${encodeURIComponent(String(offset))}` : ''
      return await request(`/api/bot/telegram/resume/provider/tasks${query}`, {
        headers: actorHeaders(actor)
      })
    },
    async providerTask(workflowId: number, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/resume/workflows/${encodeURIComponent(String(workflowId))}`, {
        headers: actorHeaders(actor)
      })
    },
    async advanceWorkflow(workflowId: number, expectedStatus: string, actor?: SupportBotActor) {
      return await request(`/api/bot/telegram/resume/workflows/${encodeURIComponent(String(workflowId))}/advance`, {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({ actor, expectedStatus })
      })
    },
    async saveKiraComments(comments: string, actor?: SupportBotActor) {
      return await request('/api/bot/telegram/resume/kira-comments', {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({ actor, comments })
      })
    },
    async saveResumeTaskInput(text: string, actor?: SupportBotActor, options: { workflowId?: number; expectedStatus?: string } = {}) {
      return await request('/api/bot/telegram/resume/task-input', {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({
          actor,
          text,
          workflowId: options.workflowId,
          expectedStatus: options.expectedStatus
        })
      })
    }
  }
}

function userIdFromMessage(message: any): string {
  return String(message?.from?.id ?? 'unknown')
}

function usernameFromMessage(message: any): string {
  return String(message?.from?.username ?? '').trim()
}

function isOpenTasksText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  const name = commandName(text)
  return normalized === 'open my tasks' || name === '/open_my_tasks' || name === '/tasks'
}

function isCommandsText(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  const name = commandName(text)
  return name === '/commands' || name === '/help' || normalized === 'show all my commands'
}

function isStudentApprovalText(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]+$/g, '')
  return [
    'i approve',
    'approve',
    'approved',
    'ok',
    'looks good',
    'да',
    'одобряю',
    'согласен',
    'согласна',
    'подтверждаю'
  ].includes(normalized)
}

function supportBotCommandsText(options: { includeTaskCommands?: boolean } = {}): string {
  const lines = [
    'Вот что я умею:',
    '/backend_status - проверить, работает ли бэкенд.',
    '/whoami - показать ID этого чата и твой Telegram user ID.',
    '/student - показать ученика, привязанного к этому чату.',
    '/resume - продвинуть резюме на следующий шаг, если сейчас твоя очередь.',
    '/resume_status - показать текущий статус резюме.'
  ]

  if (options.includeTaskCommands) {
    lines.push('/open_my_tasks - личная очередь задач для Киры/подрядчика.')
  }

  lines.push('', 'Команды работают только если этот чат или Telegram-аккаунт привязан к нужному ученику или роли.')
  return lines.join('\n')
}

async function handleCommands(actor: SupportBotActor, api: SupportBotApiClient): Promise<SupportBotResponse> {
  let includeTaskCommands = false

  if (actor.chatType === 'private') {
    try {
      await api.providerTasks(actor)
      includeTaskCommands = true
    } catch (error: any) {
      if (isBackendUnavailableError(error)) {
        return supportBotCommandsText()
      }
      includeTaskCommands = false
    }
  }

  return supportBotCommandsText({ includeTaskCommands })
}

async function handleOpenTasks(actor: SupportBotActor, api: SupportBotApiClient): Promise<SupportBotResponse> {
  if (actor.chatType !== 'private') {
    return '/open_my_tasks работает только в личном чате. Открой личный чат с ботом и отправь там /open_my_tasks.'
  }
  clearActiveTaskContext(actor)

  return await withBackendStatusMessage(async () => {
    const result = await api.providerTasks(actor)
    return {
      text: result.message,
      replyMarkup: result.replyMarkup
    }
  })
}

async function handleSupportBotMessage(message: any, api: SupportBotApiClient): Promise<SupportBotResponse | null> {
  const text = normalizeCommandText(message?.text)
  if (!text) return null
  const chatId = String(message?.chat?.id ?? '').trim()
  const chatType = String(message?.chat?.type ?? 'unknown')
  const actor = actorFromMessage(message)
  const name = commandName(text)

  if (isCommandsText(text)) {
    return await handleCommands(actor, api)
  }

  if (isOpenTasksText(text)) {
    return await handleOpenTasks(actor, api)
  }

  if (!text.startsWith('/')) {
    if (actor.chatType !== 'private') {
      if (!isStudentApprovalText(text)) return null
      return await withBackendStatusMessage(async () => {
        const result = await api.resume(chatId, actor)
        return result.message
      })
    }
    return await withBackendStatusMessage(async () => {
      const context = activeTaskContext(actor)
      const result = await api.saveResumeTaskInput(text, actor, context
        ? { workflowId: context.workflowId, expectedStatus: context.expectedStatus }
        : {})
      if (result.workflow || result.clearActiveTask) {
        clearActiveTaskContext(actor)
      }
      return {
        text: result.message,
        replyMarkup: result.replyMarkup
      }
    })
  }

  if (name === '/whoami') {
    return [
      `ID чата: ${chatId}`,
      `Тип чата: ${chatType}`,
      `ID пользователя: ${userIdFromMessage(message)}`,
      usernameFromMessage(message) ? `Username: @${usernameFromMessage(message)}` : undefined
    ].filter(Boolean).join('\n')
  }

  if (name === '/backend_status') {
    return await withBackendStatusMessage(async () => {
      const result = await api.backendStatus()
      return result.ok ? 'Бэкенд: работает' : 'Бэкенд: не отвечает'
    })
  }

  if (name === '/start' || name === '/student') {
    return await withBackendStatusMessage(async () => {
      const result = await api.findClient(chatId, actor)
      if (!result.found || !result.client) {
        return [
          'Для этого Telegram-чата ученик не найден.',
          '',
          `ID чата: ${chatId}`,
          'Привяжи этот ID чата к ученику в админке NocoDB.'
        ].join('\n')
      }
      if (name === '/start') {
        return [
          `Привет, ${result.client.name}! Я бот поддержки Very Evil Unicorn! 🦄`,
          '',
          'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
          'Отправь /commands, чтобы посмотреть список команд.'
        ].join('\n')
      }
      return [
        `Ученик найден: ${result.client.name}`,
        '',
        'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
        'Отправь /commands, чтобы посмотреть список команд.'
      ].join('\n')
    })
  }

  if (name === '/change_google_folder') {
    return 'Редактирование Google-папки из Telegram отключено. Измени корневую Google-папку в админке Noco.'
  }

  if (name === '/resume') {
    if (actor.chatType === 'private') {
      return 'Работай с задачами по резюме через /open_my_tasks.'
    }
    return await withBackendStatusMessage(async () => {
      const result = await api.resume(chatId, actor, {
        studentDataFolderUrl: commandArgument(text)
      })
      return result.message
    })
  }

  if (name === '/resume_status') {
    return await withBackendStatusMessage(async () => {
      const result = await api.resumeStatus(chatId, actor)
      return result.message
    })
  }

  if (name === '/resume_reset_test') {
    return await withBackendStatusMessage(async () => {
      const result = await api.resumeResetTest(chatId, actor)
      return result.message
    })
  }

  return null
}

async function handleSupportBotCallback(callbackQuery: any, api: SupportBotApiClient): Promise<SupportBotResponse | null> {
  const data = String(callbackQuery?.data ?? '').trim()
  const actor = actorFromCallbackQuery(callbackQuery)
  const parts = data.split(':')
  if (parts[0] !== 'resume') return null

  if (parts[1] === 'tasks') {
    clearActiveTaskContext(actor)
    const offset = Number(parts[2])
    return await withBackendStatusMessage(async () => {
      const result = await api.providerTasks(actor, Number.isFinite(offset) && offset > 0 ? offset : 0)
      return { text: result.message, replyMarkup: result.replyMarkup }
    })
  }

  const workflowId = Number(parts[2])
  if (!Number.isFinite(workflowId) || workflowId <= 0) {
    return 'Это действие по резюме недействительно. Обнови список задач.'
  }

  if (parts[1] === 'open') {
    return await withBackendStatusMessage(async () => {
      const result = await api.providerTask(workflowId, actor)
      if (result.workflow) {
        rememberActiveTaskContext(actor, workflowId, String(result.workflow.status ?? ''))
      } else {
        clearActiveTaskContext(actor)
      }
      return { text: result.message, replyMarkup: result.replyMarkup }
    })
  }

  if (parts[1] === 'advance') {
    const expectedStatus = decodeCallbackStatus(parts[3])
    return await withBackendStatusMessage(async () => {
      const result = await api.advanceWorkflow(workflowId, expectedStatus, actor)
      return result.message
    })
  }

  return null
}

function isGroupChat(value: unknown): boolean {
  const type = String(value ?? '').trim().toLowerCase()
  return type === 'group' || type === 'supergroup'
}

function isBotActivatedInGroup(chatMemberUpdate: any): boolean {
  const chat = chatMemberUpdate?.chat
  if (!isGroupChat(chat?.type)) return false
  const previous = String(chatMemberUpdate?.old_chat_member?.status ?? '').trim().toLowerCase()
  const next = String(chatMemberUpdate?.new_chat_member?.status ?? '').trim().toLowerCase()
  return ['left', 'kicked'].includes(previous) && ['member', 'administrator'].includes(next)
}

async function handleSupportBotGroupAdd(update: any, api: SupportBotApiClient): Promise<SupportBotResponse | null> {
  const chatMemberUpdate = update?.my_chat_member
  if (!isBotActivatedInGroup(chatMemberUpdate)) return null
  const chatId = String(chatMemberUpdate?.chat?.id ?? '').trim()
  if (!chatId) return null

  return await withBackendStatusMessage(async () => {
    const result = await api.findClient(chatId)
    const studentName = result.found && result.client?.name
      ? result.client.name
      : String(chatMemberUpdate?.chat?.title ?? 'there').trim() || 'there'
    const resumeStatus = await api.resumeStatus(chatId)
    return [
      `Привет, ${studentName}! Я бот поддержки Very Evil Unicorn! 🦄`,
      '',
      'Бот сейчас в бета-версии, поэтому часть функций может меняться.',
      'Отправь /commands, чтобы посмотреть список команд.',
      '',
      resumeStatus.message
    ].join('\n')
  })
}

async function sendBotResponse(
  botApi: ReturnType<typeof createTelegramBotApi>,
  chatId: string,
  response: SupportBotResponse
): Promise<void> {
  if (typeof response === 'string') {
    await botApi.sendMessage({ chatId, text: response })
    return
  }
  await botApi.sendMessage({
    chatId,
    text: response.text,
    replyMarkup: response.replyMarkup,
    parseMode: response.parseMode
  })
}

async function sendBotResponseQuietly(
  botApi: ReturnType<typeof createTelegramBotApi>,
  chatId: string,
  response: SupportBotResponse
): Promise<void> {
  try {
    await sendBotResponse(botApi, chatId, response)
  } catch (error: any) {
    console.error(`Failed to send Telegram bot response: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function answerCallbackQueryQuietly(
  botApi: ReturnType<typeof createTelegramBotApi>,
  input: { callbackQueryId: string; text?: string }
): Promise<void> {
  try {
    await botApi.answerCallbackQuery(input)
  } catch (error: any) {
    const message = String(error?.message ?? '').toLowerCase()
    if (message.includes('query is too old') || message.includes('query id is invalid')) return
    throw error
  }
}

function isTransientTelegramPollingError(error: any): boolean {
  const code = String(error?.code ?? '').trim()
  if (code === 'telegram_bot_token_missing') return false
  const status = Number(error?.status ?? error?.details?.status ?? error?.details?.data?.error_code)
  const message = String(error?.message ?? error?.details?.data?.description ?? '').toLowerCase()
  return (
    status === 409 ||
    status === 429 ||
    [500, 502, 503, 504].includes(status) ||
    message.includes('terminated by other getupdates request') ||
    message.includes('too many requests') ||
    message.includes('timeout') ||
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
  )
}

function userFacingErrorMessage(error: any): string {
  if (isBackendOverloadedError(error)) return BACKEND_OVERLOADED_MESSAGE
  if (isBackendUnavailableError(error)) return BACKEND_UNAVAILABLE_MESSAGE
  return String(error?.message ?? '').trim() || GENERIC_BOT_ERROR_MESSAGE
}

async function runSupportBot(options: {
  botApi?: ReturnType<typeof createTelegramBotApi>
  apiClient?: SupportBotApiClient
  pollTimeout?: number
  allowedUpdates?: string[]
  initialOffset?: number
  stopSignal?: AbortSignal
  idleDelayMs?: number
  pollErrorDelayMs?: number
} = {}) {
  const botApi = options.botApi ?? createTelegramBotApi()
  const apiClient = options.apiClient ?? createSupportBotApiClient()
  let offset = Number(options.initialOffset ?? 0)
  const idleDelayMs = Number(options.idleDelayMs ?? 0)
  const pollErrorDelayMs = Number.isFinite(Number(options.pollErrorDelayMs)) ? Math.max(0, Number(options.pollErrorDelayMs)) : 5000
  const allowedUpdates = options.allowedUpdates ?? SUPPORT_BOT_ALLOWED_UPDATES
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  while (!options.stopSignal?.aborted) {
    let updates: any[]
    try {
      updates = await botApi.getUpdates(offset || undefined, options.pollTimeout ?? 30, allowedUpdates)
    } catch (error: any) {
      if (!isTransientTelegramPollingError(error)) throw error
      console.error(`Telegram polling failed temporarily: ${error instanceof Error ? error.message : String(error)}`)
      if (pollErrorDelayMs > 0) await wait(pollErrorDelayMs)
      continue
    }
    if (!updates.length && idleDelayMs > 0) await wait(idleDelayMs)
    for (const update of updates) {
      if (options.stopSignal?.aborted) break
      offset = Math.max(offset, Number(update.update_id) + 1)
      const message = update.message
      const callbackQuery = update.callback_query
      const chatMemberUpdate = update.my_chat_member
      try {
        if (chatMemberUpdate?.chat?.id) {
          const response = await handleSupportBotGroupAdd(update, apiClient)
          if (response) await sendBotResponse(botApi, String(chatMemberUpdate.chat.id), response)
          continue
        }

        if (callbackQuery?.id) {
          const response = await handleSupportBotCallback(callbackQuery, apiClient)
          await answerCallbackQueryQuietly(botApi, { callbackQueryId: String(callbackQuery.id) })
          const chatId = String(callbackQuery.message?.chat?.id ?? callbackQuery.from?.id ?? '').trim()
          if (response && chatId) await sendBotResponse(botApi, chatId, response)
          continue
        }

        if (!message?.chat?.id) continue
        const response = await handleSupportBotMessage(message, apiClient)
        if (response) await sendBotResponse(botApi, String(message.chat.id), response)
      } catch (error: any) {
        console.error(error instanceof Error ? error.stack || error.message : String(error))
        const chatId = String(chatMemberUpdate?.chat?.id ?? callbackQuery?.message?.chat?.id ?? callbackQuery?.from?.id ?? message?.chat?.id ?? '').trim()
        const errorText = userFacingErrorMessage(error)
        if (callbackQuery?.id) {
          await answerCallbackQueryQuietly(botApi, {
            callbackQueryId: String(callbackQuery.id),
            text: errorText
          }).catch(() => undefined)
        }
        if (chatId) {
          await sendBotResponseQuietly(botApi, chatId, errorText)
        }
      }
    }
  }
}

if (require.main === module) {
  runSupportBot().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

module.exports = {
  actorFromCallbackQuery,
  actorFromMessage,
  BACKEND_OVERLOADED_MESSAGE,
  BACKEND_UNAVAILABLE_MESSAGE,
  SUPPORT_BOT_ALLOWED_UPDATES,
  commandArgument,
  commandName,
  createSupportBotApiClient,
  clearActiveTaskContextsForTest,
  handleSupportBotCallback,
  handleSupportBotGroupAdd,
  handleSupportBotMessage,
  isBackendUnavailableError,
  responseText,
  runSupportBot
}
