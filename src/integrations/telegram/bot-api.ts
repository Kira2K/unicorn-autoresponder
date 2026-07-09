type BotApiRequester = (url: string, options: Record<string, unknown>) => Promise<{
  ok: boolean
  status: number
  json(): Promise<any>
}>

type SendMessageInput = {
  chatId: string
  text: string
  replyMarkup?: unknown
  parseMode?: string
}

function botError(code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { code, details })
}

function resolveBotToken(token = process.env.VEU_SUPPORT_BOT): string {
  const resolved = String(token ?? '').trim()
  if (!resolved) {
    throw botError('telegram_bot_token_missing', 'VEU_SUPPORT_BOT is not configured.')
  }
  return resolved
}

function createTelegramBotApi(options: {
  token?: string
  requester?: BotApiRequester
  baseUrl?: string
  requestTimeoutMs?: number
} = {}) {
  const requester = options.requester ?? ((url, requestOptions) => fetch(url, requestOptions as any) as any)
  const baseUrl = String(options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')

  async function request(method: string, body: Record<string, unknown> = {}) {
    const token = resolveBotToken(options.token)
    const longPollTimeoutMs = (Number(body.timeout) + 10) * 1000
    const requestTimeoutMs = Number(options.requestTimeoutMs ?? Math.max(15000, longPollTimeoutMs || 0))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await requester(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data?.ok === false) {
        throw botError(
          'telegram_bot_api_failed',
          String(data?.description || `Telegram Bot API request failed with status ${response.status}.`),
          { status: response.status, data }
        )
      }
      return data.result ?? data
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async sendMessage(input: SendMessageInput) {
      const chatId = String(input.chatId ?? '').trim()
      const text = String(input.text ?? '').trim()
      if (!chatId) throw botError('telegram_bot_chat_id_missing', 'Telegram chat ID is required.')
      if (!text) throw botError('telegram_bot_empty_message', 'Telegram message text is required.')
      return await request('sendMessage', {
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
        ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {})
      })
    },
    async answerCallbackQuery(input: { callbackQueryId: string; text?: string }) {
      const callbackQueryId = String(input.callbackQueryId ?? '').trim()
      if (!callbackQueryId) throw botError('telegram_callback_query_id_missing', 'Telegram callback query ID is required.')
      return await request('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(input.text ? { text: input.text } : {})
      })
    },
    async getUpdates(offset?: number, timeout = 30, allowedUpdates?: string[]) {
      return await request('getUpdates', {
        ...(offset ? { offset } : {}),
        timeout,
        ...(allowedUpdates ? { allowed_updates: allowedUpdates } : {})
      })
    }
  }
}

module.exports = {
  botError,
  createTelegramBotApi,
  resolveBotToken
}
