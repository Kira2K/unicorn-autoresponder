type BotApiRequester = (url: string, options: Record<string, unknown>) => Promise<{
  ok: boolean
  status: number
  json(): Promise<any>
}>

type SendMessageInput = {
  chatId: string
  text: string
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
} = {}) {
  const requester = options.requester ?? ((url, requestOptions) => fetch(url, requestOptions as any) as any)
  const baseUrl = String(options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')

  async function request(method: string, body: Record<string, unknown> = {}) {
    const token = resolveBotToken(options.token)
    const response = await requester(`${baseUrl}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
        disable_web_page_preview: true
      })
    },
    async getUpdates(offset?: number, timeout = 30) {
      return await request('getUpdates', {
        ...(offset ? { offset } : {}),
        timeout
      })
    }
  }
}

module.exports = {
  botError,
  createTelegramBotApi,
  resolveBotToken
}
