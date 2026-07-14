require('dotenv').config()

const { createTelegramBotApi } = require('./bot-api.ts') as {
  createTelegramBotApi(options?: any): {
    getUpdates(offset?: number, timeout?: number, allowedUpdates?: string[]): Promise<any[]>
    sendMessage(input: { chatId: string; text: string; replyMarkup?: unknown; parseMode?: string }): Promise<unknown>
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
  providerTasks(actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown }>
  providerTask(workflowId: number, actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown }>
  advanceWorkflow(workflowId: number, expectedStatus: string, actor?: SupportBotActor): Promise<{ found: boolean; message: string; workflow?: { status?: string } }>
  saveKiraComments(comments: string, actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown }>
  saveResumeTaskInput(text: string, actor?: SupportBotActor): Promise<{ message: string; replyMarkup?: unknown }>
}

const BACKEND_UNAVAILABLE_MESSAGE = 'Sorry, no backend. Please try again later.'
const SUPPORT_BOT_ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member']

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

function decodeCallbackStatus(value: string | undefined): string {
  if (!value) return ''
  return Buffer.from(value, 'base64url').toString('utf8')
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

function backendRequestTimeoutMs(value: unknown = process.env.SUPPORT_BOT_BACKEND_TIMEOUT_MS): number {
  const timeoutMs = Number(value)
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000
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
    async providerTasks(actor?: SupportBotActor) {
      return await request('/api/bot/telegram/resume/provider/tasks', {
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
    async saveResumeTaskInput(text: string, actor?: SupportBotActor) {
      return await request('/api/bot/telegram/resume/task-input', {
        method: 'POST',
        headers: actorHeaders(actor),
        body: JSON.stringify({ actor, text })
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
    "Here's what I can do:",
    '/backend_status - check if the backend is alive.',
    '/whoami - show this chat ID and your Telegram user ID.',
    '/student - show the student linked to this group.',
    '/resume - move the resume workflow one step when it is your turn.',
    '/resume_status - show the current resume workflow status.'
  ]

  if (options.includeTaskCommands) {
    lines.push('/open_my_tasks - private Kira/Provider queue for resume tasks.')
  }

  lines.push('', 'Commands only work when this chat or Telegram account is linked to the right student or role.')
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
    return 'Open my tasks is private. Please open a private chat with this bot and send /open_my_tasks there.'
  }

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
      const result = await api.saveResumeTaskInput(text, actor)
      return {
        text: result.message,
        replyMarkup: result.replyMarkup
      }
    })
  }

  if (name === '/whoami') {
    return [
      `Chat ID: ${chatId}`,
      `Chat type: ${chatType}`,
      `User ID: ${userIdFromMessage(message)}`,
      usernameFromMessage(message) ? `Username: @${usernameFromMessage(message)}` : undefined
    ].filter(Boolean).join('\n')
  }

  if (name === '/backend_status') {
    return await withBackendStatusMessage(async () => {
      const result = await api.backendStatus()
      return result.ok ? 'Backend: ok' : 'Backend: not ok'
    })
  }

  if (name === '/start' || name === '/student') {
    return await withBackendStatusMessage(async () => {
      const result = await api.findClient(chatId, actor)
      if (!result.found || !result.client) {
        return [
          'No student found for this Telegram chat.',
          '',
          `Chat ID: ${chatId}`,
          'Please link this chat ID to a student in NocoDB/Admin Console.'
        ].join('\n')
      }
      return `Student found: ${result.client.name}`
    })
  }

  if (name === '/change_google_folder') {
    return 'Google folder editing from Telegram is disabled. Please edit the root Google folder in Noco/Admin Console.'
  }

  if (name === '/resume') {
    if (actor.chatType === 'private') {
      return 'Please operate resume tasks via /open_my_tasks.'
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
    return await withBackendStatusMessage(async () => {
      const result = await api.providerTasks(actor)
      return { text: result.message, replyMarkup: result.replyMarkup }
    })
  }

  const workflowId = Number(parts[2])
  if (!Number.isFinite(workflowId) || workflowId <= 0) {
    return 'This resume action is invalid. Please refresh your tasks.'
  }

  if (parts[1] === 'open') {
    return await withBackendStatusMessage(async () => {
      const result = await api.providerTask(workflowId, actor)
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
    return [
      `Hello ${studentName}, I'm a unicorn support bot!`,
      'Please complete the required profile details about yourself in the Console.',
      'Add self-presentation and resume files to your Google folder when this stage asks for them.',
      'Send /commands to see what I can do.'
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

async function runSupportBot(options: {
  botApi?: ReturnType<typeof createTelegramBotApi>
  apiClient?: SupportBotApiClient
  pollTimeout?: number
  allowedUpdates?: string[]
  initialOffset?: number
  stopSignal?: AbortSignal
  idleDelayMs?: number
} = {}) {
  const botApi = options.botApi ?? createTelegramBotApi()
  const apiClient = options.apiClient ?? createSupportBotApiClient()
  let offset = Number(options.initialOffset ?? 0)
  const idleDelayMs = Number(options.idleDelayMs ?? 0)
  const allowedUpdates = options.allowedUpdates ?? SUPPORT_BOT_ALLOWED_UPDATES
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  while (!options.stopSignal?.aborted) {
    const updates = await botApi.getUpdates(offset || undefined, options.pollTimeout ?? 30, allowedUpdates)
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
        if (callbackQuery?.id) {
          await answerCallbackQueryQuietly(botApi, {
            callbackQueryId: String(callbackQuery.id),
            text: error?.message || 'Telegram bot command failed.'
          }).catch(() => undefined)
        }
        if (chatId) {
          await botApi.sendMessage({
            chatId,
            text: error?.message || 'Telegram bot command failed.'
          })
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
  BACKEND_UNAVAILABLE_MESSAGE,
  SUPPORT_BOT_ALLOWED_UPDATES,
  commandArgument,
  commandName,
  createSupportBotApiClient,
  handleSupportBotCallback,
  handleSupportBotGroupAdd,
  handleSupportBotMessage,
  isBackendUnavailableError,
  responseText,
  runSupportBot
}
