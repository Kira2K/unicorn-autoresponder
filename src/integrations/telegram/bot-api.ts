import { prepareTelegramRichMessage } from './prepare-message.ts'

type BotApiHttpResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type BotApiRequester = (
  url: string,
  options: Record<string, unknown>
) => Promise<BotApiHttpResponse>

type SendMessageInput = {
  chatId: string
  text: string
  messageThreadId?: number
  replyMarkup?: unknown
  parseMode?: import('./types.ts').SendOneInput['parseMode']
  linkPreviewOptions?: unknown
}

export function botError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown
) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    code,
    ...(details ? { details } : {})
  })
}

export function resolveBotToken(token = process.env.VEU_SUPPORT_BOT): string {
  const resolved = String(token ?? '').trim()
  if (!resolved) {
    throw botError('telegram_bot_token_missing', 'VEU_SUPPORT_BOT is not configured.')
  }
  return resolved
}

export function createTelegramBotApi(options: {
  token?: string
  requester?: BotApiRequester
  baseUrl?: string
  requestTimeoutMs?: number
} = {}) {
  const baseUrl = String(options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '')

  async function requestResponse(method: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const token = resolveBotToken(options.token)
    const requester = options.requester ?? globalThis.fetch
    if (typeof requester !== 'function' || typeof AbortController !== 'function') {
      throw botError(
        'telegram_bot_runtime_unavailable',
        'Telegram Bot API fetch runtime is not available.'
      )
    }

    const longPollTimeoutMs = (Number(body.timeout) + 90) * 1000
    const requestTimeoutMs = Number(
      options.requestTimeoutMs ?? Math.max(15000, longPollTimeoutMs || 0)
    )
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw botError(
        'telegram_bot_timeout_invalid',
        'Telegram Bot API request timeout is invalid.'
      )
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const requestOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      }
      let response: BotApiHttpResponse
      try {
        response = await requester(
          `${baseUrl}/bot${token}/${method}`,
          requestOptions
        ) as BotApiHttpResponse
      } catch (error) {
        throw botError(
          'telegram_bot_transport_failed',
          'Telegram Bot API request failed before a response was received.',
          undefined,
          error
        )
      }

      if (!response || typeof response.json !== 'function') {
        throw botError(
          'telegram_bot_response_unreadable',
          'Telegram Bot API response cannot be read.',
          { status: Number(response?.status) || 0 }
        )
      }

      try {
        return await response.json()
      } catch (error) {
        throw botError(
          'telegram_bot_response_invalid_json',
          'Telegram Bot API response was not valid JSON.',
          { status: Number(response.status) || 0 },
          error
        )
      }
    } finally {
      clearTimeout(timer)
    }
  }

  function sendMessageBody(input: SendMessageInput): Record<string, unknown> {
    return {
      chat_id: input.chatId,
      ...(input.messageThreadId !== undefined
        ? { message_thread_id: input.messageThreadId }
        : {}),
      text: input.text,
      ...(input.linkPreviewOptions !== undefined
        ? { link_preview_options: input.linkPreviewOptions }
        : { disable_web_page_preview: true }),
      ...(input.parseMode ? { parse_mode: input.parseMode } : {}),
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {})
    }
  }

  async function sendResponse(input: SendMessageInput): Promise<unknown> {
    const richMessage = prepareTelegramRichMessage(input)
    if (!richMessage) return await requestResponse('sendMessage', sendMessageBody(input))
    return await requestResponse('sendRichMessage', {
      chat_id: input.chatId,
      ...(input.messageThreadId !== undefined ? { message_thread_id: input.messageThreadId } : {}),
      rich_message: richMessage,
      ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {})
    })
  }

  async function unwrapLegacyResponse(data: unknown): Promise<unknown> {
    if (!data || typeof data !== 'object') {
      throw botError(
        'telegram_bot_response_invalid',
        'Telegram Bot API returned an invalid response.'
      )
    }
    const response = data as Record<string, unknown>
    if (response.ok === false) {
      throw botError(
        'telegram_bot_api_failed',
        String(response.description || 'Telegram Bot API request failed.'),
        { data: response }
      )
    }
    if (response.ok !== true || !('result' in response)) {
      throw botError(
        'telegram_bot_response_invalid',
        'Telegram Bot API returned an invalid response.'
      )
    }
    return response.result
  }

  return {
    async sendMessageResponse(input: SendMessageInput): Promise<unknown> {
      return await sendResponse(input)
    },
    async sendMessage(input: SendMessageInput): Promise<unknown> {
      const chatId = String(input.chatId ?? '').trim()
      const text = String(input.text ?? '').trim()
      if (!chatId) throw botError('telegram_bot_chat_id_missing', 'Telegram chat ID is required.')
      if (!text) throw botError('telegram_bot_empty_message', 'Telegram message text is required.')
      return await unwrapLegacyResponse(await sendResponse({
        ...input,
        chatId,
        text
      }))
    },
    async answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<unknown> {
      const callbackQueryId = String(input.callbackQueryId ?? '').trim()
      if (!callbackQueryId) {
        throw botError(
          'telegram_callback_query_id_missing',
          'Telegram callback query ID is required.'
        )
      }
      return await unwrapLegacyResponse(await requestResponse('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(input.text ? { text: input.text } : {})
      }))
    },
    async getUpdates(
      offset?: number,
      timeout = 30,
      allowedUpdates?: string[]
    ): Promise<unknown[]> {
      const result = await unwrapLegacyResponse(await requestResponse('getUpdates', {
        ...(offset ? { offset } : {}),
        timeout,
        ...(allowedUpdates ? { allowed_updates: allowedUpdates } : {})
      }))
      return Array.isArray(result) ? result : []
    }
  }
}
