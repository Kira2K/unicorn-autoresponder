require('dotenv').config()

const { createTelegramBotApi } = require('./bot-api.ts') as {
  createTelegramBotApi(options?: any): {
    getUpdates(offset?: number, timeout?: number): Promise<any[]>
    sendMessage(input: { chatId: string; text: string }): Promise<unknown>
  }
}

type SupportBotApiClient = {
  findClient(chatId: string): Promise<{ found: boolean; chatId: string; client?: { id: number; name: string; chatId: string; googleFolder: string } }>
  updateGoogleFolder(chatId: string, googleFolder: string): Promise<{ success: boolean; error?: string; chatId?: string; client?: { id: number; name: string; chatId: string; googleFolder: string } }>
}

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

function createSupportBotApiClient(options: {
  baseUrl?: string
  token?: string
  requester?: typeof fetch
} = {}): SupportBotApiClient {
  const baseUrl = String(options.baseUrl ?? process.env.WEB_CONSOLE_BASE_URL ?? 'http://127.0.0.1:4300').replace(/\/+$/, '')
  const token = String(options.token ?? process.env.WEB_CONSOLE_BOT_API_TOKEN ?? '').trim()
  const requester = options.requester ?? fetch

  async function request(path: string, requestOptions: Record<string, unknown> = {}) {
    if (!token) {
      throw Object.assign(new Error('WEB_CONSOLE_BOT_API_TOKEN is not configured.'), { code: 'bot_api_token_missing' })
    }
    const response = await requester(`${baseUrl}${path}`, {
      ...requestOptions,
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Api-Token': token,
        ...((requestOptions.headers as Record<string, string>) ?? {})
      }
    } as any)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw Object.assign(new Error(body.message || body.error || `Bot API request failed: ${response.status}`), {
        code: body.error || 'bot_api_request_failed',
        status: response.status,
        body
      })
    }
    return body
  }

  return {
    async findClient(chatId: string) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/client`)
    },
    async updateGoogleFolder(chatId: string, googleFolder: string) {
      return await request(`/api/bot/telegram/chats/${encodeURIComponent(chatId)}/google-folder`, {
        method: 'PATCH',
        body: JSON.stringify({ googleFolder })
      })
    }
  }
}

function userIdFromMessage(message: any): string {
  return String(message?.from?.id ?? 'unknown')
}

async function handleSupportBotMessage(message: any, api: SupportBotApiClient): Promise<string | null> {
  const text = normalizeCommandText(message?.text)
  if (!text.startsWith('/')) return null
  const chatId = String(message?.chat?.id ?? '').trim()
  const chatType = String(message?.chat?.type ?? 'unknown')
  const name = commandName(text)

  if (name === '/whoami') {
    return [
      `Chat ID: ${chatId}`,
      `Chat type: ${chatType}`,
      `User ID: ${userIdFromMessage(message)}`
    ].join('\n')
  }

  if (name === '/start' || name === '/student') {
    const result = await api.findClient(chatId)
    if (!result.found || !result.client) {
      return [
        'No student found for this Telegram chat.',
        '',
        `Chat ID: ${chatId}`,
        'Please link this chat ID to a student in NocoDB/Admin Console.'
      ].join('\n')
    }
    return `Student found: ${result.client.name}`
  }

  if (name === '/change_google_folder') {
    const googleFolder = commandArgument(text)
    if (!googleFolder) return 'Google folder value is required.'
    const result = await api.updateGoogleFolder(chatId, googleFolder)
    if (!result.success || !result.client) {
      return [
        'No student found for this Telegram chat.',
        '',
        `Chat ID: ${chatId}`,
        'Please link this chat ID to a student in NocoDB/Admin Console.'
      ].join('\n')
    }
    return [
      `Google folder updated for ${result.client.name}.`,
      `New value: ${result.client.googleFolder}`
    ].join('\n')
  }

  return null
}

async function runSupportBot(options: {
  botApi?: ReturnType<typeof createTelegramBotApi>
  apiClient?: SupportBotApiClient
  pollTimeout?: number
} = {}) {
  const botApi = options.botApi ?? createTelegramBotApi()
  const apiClient = options.apiClient ?? createSupportBotApiClient()
  let offset = 0
  for (;;) {
    const updates = await botApi.getUpdates(offset || undefined, options.pollTimeout ?? 30)
    for (const update of updates) {
      offset = Math.max(offset, Number(update.update_id) + 1)
      const message = update.message
      if (!message?.chat?.id) continue
      try {
        const response = await handleSupportBotMessage(message, apiClient)
        if (response) await botApi.sendMessage({ chatId: String(message.chat.id), text: response })
      } catch (error: any) {
        await botApi.sendMessage({
          chatId: String(message.chat.id),
          text: error?.message || 'Telegram bot command failed.'
        })
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
  commandArgument,
  commandName,
  createSupportBotApiClient,
  handleSupportBotMessage,
  runSupportBot
}
