import type { ApiError, ApiResponse, Message } from '@grammyjs/types'
import type {
  ClientFailure,
  ClientFailureStage,
  SendManyInput,
  SendManyResult,
  SendOneInput,
  SendOneResult,
  TelegramCommandContext,
  TelegramCommandDispatchResult,
  TelegramCommandHandler,
  TelegramCommandName
} from './types.ts'
import {
  sanitizeTelegramValue,
  serializeTelegramError
} from './sanitize.ts'
import { createTelegramBotApi } from './bot-api.ts'

type HttpResponseLike = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

type TelegramLogger = (event: Readonly<Record<string, unknown>>) => void

type RawBotApi = {
  sendMessageResponse(input: SendOneInput): Promise<unknown>
}

type TelegramIntegrationOptions = {
  token?: string
  requester?: (url: string, options: Record<string, unknown>) => Promise<HttpResponseLike>
  baseUrl?: string
  requestTimeoutMs?: number
  logger?: TelegramLogger
  delay?: (milliseconds: number) => Promise<void>
  batchDelayMs?: number
  regularErrorChatId?: string
  summaryLogsChatId?: string
  env?: Record<string, string | undefined>
  botApi?: RawBotApi
  batchSendOne?: (input: SendOneInput) => Promise<SendOneResult>
}

const COMMAND_NAME = /^\/[a-z0-9_]{1,32}$/i
const COMMAND_TOKEN = /^\/[a-z0-9_]{1,32}(?:@[a-z0-9_]{1,32})?$/i
const PARSE_MODES = new Set(['Markdown', 'MarkdownV2', 'HTML'])
const REGULAR_ERROR_CHAT_ID = '-5216637594'

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function namedError(
  name: string,
  message: string,
  code?: string,
  details?: Record<string, unknown>
): Error & { code?: string; details?: Record<string, unknown> } {
  return Object.assign(new Error(message), {
    name,
    ...(code ? { code } : {}),
    ...(details ? { details } : {})
  })
}

function failure(
  stage: ClientFailureStage,
  error: unknown,
  secrets: readonly string[]
): ClientFailure {
  return {
    stage,
    error: serializeTelegramError(error, { secrets })
  }
}

function validateSendOneInput(input: unknown):
  | { ok: true; input: SendOneInput }
  | { ok: false; error: Error } {
  if (!isObject(input)) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram send input must be an object.',
        'telegram_send_input_invalid'
      )
    }
  }
  if (typeof input.chatId !== 'string' || !input.chatId.trim()) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram chat ID is required.',
        'telegram_bot_chat_id_missing'
      )
    }
  }
  if (typeof input.text !== 'string' || !input.text.trim()) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram message text is required.',
        'telegram_bot_empty_message'
      )
    }
  }
  if (
    input.messageThreadId !== undefined &&
    (!Number.isSafeInteger(input.messageThreadId) || Number(input.messageThreadId) <= 0)
  ) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram message thread ID must be a positive safe integer.',
        'telegram_message_thread_id_invalid'
      )
    }
  }
  if (
    input.parseMode !== undefined &&
    (typeof input.parseMode !== 'string' || !PARSE_MODES.has(input.parseMode))
  ) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram parse mode is invalid.',
        'telegram_parse_mode_invalid'
      )
    }
  }
  for (const key of ['replyMarkup', 'linkPreviewOptions'] as const) {
    if (input[key] !== undefined && !isObject(input[key])) {
      return {
        ok: false,
        error: namedError(
          'TelegramSendValidationError',
          `Telegram ${key} must be an object.`,
          'telegram_send_option_invalid',
          { field: key }
        )
      }
    }
  }
  try {
    JSON.stringify({
      replyMarkup: input.replyMarkup,
      linkPreviewOptions: input.linkPreviewOptions
    })
  } catch (error) {
    return {
      ok: false,
      error: namedError(
        'TelegramSendValidationError',
        'Telegram send input is not JSON serializable.',
        'telegram_send_input_not_serializable',
        { cause: serializeTelegramError(error) }
      )
    }
  }
  return {
    ok: true,
    input: {
      chatId: input.chatId.trim(),
      text: input.text,
      ...(input.messageThreadId !== undefined
        ? { messageThreadId: Number(input.messageThreadId) }
        : {}),
      ...(input.parseMode !== undefined ? { parseMode: input.parseMode as SendOneInput['parseMode'] } : {}),
      ...(input.replyMarkup !== undefined
        ? { replyMarkup: input.replyMarkup as SendOneInput['replyMarkup'] }
        : {}),
      ...(input.linkPreviewOptions !== undefined
        ? { linkPreviewOptions: input.linkPreviewOptions as SendOneInput['linkPreviewOptions'] }
        : {})
    }
  }
}

function validTelegramResponse(
  value: unknown
): value is ApiResponse<Message.TextMessage> {
  if (!isObject(value)) return false
  if (value.ok === false) {
    return typeof value.error_code === 'number' && typeof value.description === 'string'
  }
  if (value.ok !== true || !isObject(value.result)) return false
  const result = value.result
  return (
    typeof result.message_id === 'number' &&
    typeof result.date === 'number' &&
    isObject(result.chat) &&
    typeof result.chat.id === 'number' &&
    typeof result.chat.type === 'string' &&
    typeof result.text === 'string'
  )
}

function errorCode(error: unknown): string {
  if (!isObject(error)) return ''
  try {
    return typeof error.code === 'string' ? error.code : ''
  } catch {
    return ''
  }
}

function classifyFailure(error: unknown): ClientFailureStage {
  const code = errorCode(error)
  if ([
    'telegram_bot_token_missing',
    'telegram_bot_runtime_unavailable',
    'telegram_bot_timeout_invalid'
  ].includes(code)) return 'configuration'
  if ([
    'telegram_bot_response_invalid_json',
    'telegram_bot_response_unreadable',
    'telegram_bot_response_invalid',
    'telegram_bot_api_failed'
  ].includes(code)) return 'response'
  if (code === 'telegram_bot_transport_failed') return 'transport'
  return 'internal'
}

function commandMessageProblem(value: unknown): string[] {
  const problems: string[] = []
  if (!isObject(value)) return ['message must be an object']
  if (typeof value.text !== 'string') problems.push('text must be a string')
  if (typeof value.message_id !== 'number') problems.push('message_id must be a number')
  if (typeof value.date !== 'number') problems.push('date must be a number')
  if (!isObject(value.chat)) {
    problems.push('chat must be an object')
  } else {
    if (typeof value.chat.id !== 'number') problems.push('chat.id must be a number')
    if (typeof value.chat.type !== 'string') problems.push('chat.type must be a string')
  }
  return problems
}

function safelyReadNumber(value: unknown, path: readonly string[]): number | undefined {
  try {
    let current = value
    for (const key of path) {
      if (!isObject(current)) return undefined
      current = current[key]
    }
    return typeof current === 'number' ? current : undefined
  } catch {
    return undefined
  }
}

export function createTelegramIntegration(options: TelegramIntegrationOptions = {}) {
  const env = options.env ?? process.env
  const token = String(options.token ?? env.VEU_SUPPORT_BOT ?? '').trim()
  const secrets = [token].filter(Boolean)
  const rawBotApi = options.botApi ?? createTelegramBotApi({
    ...(options.token !== undefined || options.env !== undefined ? { token } : {}),
    ...(options.requester ? { requester: options.requester } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: options.requestTimeoutMs }
      : {})
  })
  const logger: TelegramLogger = options.logger ?? (event => {
    const method = event.level === 'error' ? console.error : console.log
    method(JSON.stringify(event))
  })
  const delay = options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const batchDelayMs = options.batchDelayMs ?? 2000
  const regularErrorChatId = options.regularErrorChatId ?? REGULAR_ERROR_CHAT_ID
  const summaryLogsChatId = options.summaryLogsChatId ?? String(env.summary_logs_channel_id ?? '').trim()
  const handlers = new Map<TelegramCommandName, TelegramCommandHandler>()

  function log(event: Record<string, unknown>): void {
    const safeEvent = sanitizeTelegramValue(event, { secrets })
    try {
      logger(isObject(safeEvent) ? safeEvent : { event: 'telegram_log_invalid' })
    } catch (error) {
      try {
        console.error(JSON.stringify({
          event: 'telegram_logger_failed',
          originalEvent: safeEvent,
          error: sanitizeTelegramValue(error, { secrets })
        }))
      } catch {
        // Logging must never change integration behavior.
      }
    }
  }

  function clientFailureResult(
    stage: ClientFailureStage,
    error: unknown
  ): Extract<SendOneResult, { kind: 'client-failure' }> {
    return {
      kind: 'client-failure',
      failure: failure(stage, error, secrets)
    }
  }

  async function reportResult(
    result: SendOneResult,
    operation: string
  ): Promise<void> {
    let destination = ''
    let reportText = ''
    if (result.kind === 'telegram-response') {
      if (result.response.ok) return
      const apiError: ApiError = result.response
      destination = apiError.error_code === 401 ? summaryLogsChatId : regularErrorChatId
      const safeDescription = sanitizeTelegramValue(apiError.description, { secrets })
      reportText = [
        'Telegram integration error',
        `operation=${operation}`,
        `telegram_error_code=${apiError.error_code}`,
        `description=${typeof safeDescription === 'string' ? safeDescription.slice(0, 300) : 'Unavailable'}`
      ].join('\n')
    } else {
      destination = ['configuration', 'response', 'internal'].includes(result.failure.stage)
        ? summaryLogsChatId
        : regularErrorChatId
      reportText = [
        'Telegram integration client failure',
        `operation=${operation}`,
        `stage=${result.failure.stage}`,
        `error=${result.failure.error.name}: ${result.failure.error.message.slice(0, 300)}`
      ].join('\n')
    }

    if (!destination) {
      log({
        level: 'error',
        event: 'telegram_remote_report_skipped',
        operation,
        reason: 'destination_not_configured'
      })
      return
    }

    try {
      const report = await sendOneCore({ chatId: destination, text: reportText }, false)
      if (report.kind === 'client-failure' || !report.response.ok) {
        log({
          level: 'error',
          event: 'telegram_remote_report_failed',
          operation,
          destination,
          result: report
        })
      }
    } catch (error) {
      log({
        level: 'error',
        event: 'telegram_remote_report_failed',
        operation,
        destination,
        error: sanitizeTelegramValue(error, { secrets })
      })
    }
  }

  async function sendOneCore(input: SendOneInput, reportFailures: boolean): Promise<SendOneResult> {
    const startedAt = Date.now()
    try {
      const validated = validateSendOneInput(input)
      if (!validated.ok) {
        const result = clientFailureResult('validation', validated.error)
        log({
          level: 'error',
          event: 'telegram_send_one_validation_failed',
          durationMs: Date.now() - startedAt,
          chatId: isObject(input) && typeof input.chatId === 'string' ? input.chatId : undefined,
          textLength: isObject(input) && typeof input.text === 'string' ? input.text.length : undefined,
          failure: result.failure
        })
        if (reportFailures) await reportResult(result, 'sendOne')
        return result
      }

      log({
        level: 'info',
        event: 'telegram_send_one_started',
        chatId: validated.input.chatId,
        textLength: validated.input.text.length
      })

      let rawResponse: unknown
      try {
        rawResponse = await rawBotApi.sendMessageResponse(validated.input)
      } catch (error) {
        const result = clientFailureResult(classifyFailure(error), error)
        log({
          level: 'error',
          event: 'telegram_send_one_client_failure',
          chatId: validated.input.chatId,
          textLength: validated.input.text.length,
          durationMs: Date.now() - startedAt,
          failure: result.failure,
          internalError: sanitizeTelegramValue(error, { secrets })
        })
        if (reportFailures) await reportResult(result, 'sendOne')
        return result
      }

      if (!validTelegramResponse(rawResponse)) {
        const invalidResponseError = namedError(
          'TelegramResponseValidationError',
          'Telegram Bot API response did not match the minimum required structure.',
          'telegram_bot_response_invalid',
          { response: sanitizeTelegramValue(rawResponse, { secrets }) as Record<string, unknown> }
        )
        const result = clientFailureResult('response', invalidResponseError)
        log({
          level: 'error',
          event: 'telegram_send_one_invalid_response',
          chatId: validated.input.chatId,
          textLength: validated.input.text.length,
          durationMs: Date.now() - startedAt,
          failure: result.failure
        })
        if (reportFailures) await reportResult(result, 'sendOne')
        return result
      }

      const result: SendOneResult = {
        kind: 'telegram-response',
        response: rawResponse
      }
      if (rawResponse.ok) {
        log({
          level: 'info',
          event: 'telegram_send_one_succeeded',
          chatId: validated.input.chatId,
          telegramMessageId: rawResponse.result.message_id,
          durationMs: Date.now() - startedAt
        })
      } else {
        log({
          level: 'error',
          event: 'telegram_send_one_api_error',
          chatId: validated.input.chatId,
          telegramErrorCode: rawResponse.error_code,
          durationMs: Date.now() - startedAt
        })
        if (reportFailures) await reportResult(result, 'sendOne')
      }
      return result
    } catch (error) {
      const result = clientFailureResult('internal', error)
      log({
        level: 'error',
        event: 'telegram_send_one_internal_failure',
        durationMs: Date.now() - startedAt,
        failure: result.failure,
        internalError: sanitizeTelegramValue(error, { secrets })
      })
      if (reportFailures) await reportResult(result, 'sendOne')
      return result
    }
  }

  async function sendOne(input: SendOneInput): Promise<SendOneResult> {
    return await sendOneCore(input, true)
  }

  async function sendMany(input: SendManyInput): Promise<SendManyResult> {
    const startedAt = Date.now()
    const entries = isObject(input) ? Object.entries(input) : []
    const results: SendManyResult = {}
    log({ level: 'info', event: 'telegram_send_many_started', totalRequested: entries.length })

    for (let index = 0; index < entries.length; index += 1) {
      const [chatId, item] = entries[index]
      try {
        const send = options.batchSendOne ?? sendOne
        results[chatId] = await send({
          ...(isObject(item) ? item : { text: '' }),
          chatId
        } as SendOneInput)
      } catch (error) {
        const result = clientFailureResult('internal', error)
        results[chatId] = result
        log({
          level: 'error',
          event: 'telegram_send_many_item_internal_failure',
          chatId,
          failure: result.failure,
          internalError: sanitizeTelegramValue(error, { secrets })
        })
        await reportResult(result, 'sendMany.item')
      }

      if (index < entries.length - 1) {
        try {
          await delay(batchDelayMs)
        } catch (error) {
          log({
            level: 'error',
            event: 'telegram_send_many_delay_failed',
            durationMs: batchDelayMs,
            internalError: sanitizeTelegramValue(error, { secrets })
          })
        }
      }
    }

    const counts = {
      telegramSuccesses: 0,
      telegramApiErrors: 0,
      clientFailures: {
        validation: 0,
        configuration: 0,
        transport: 0,
        response: 0,
        internal: 0
      }
    }
    for (const result of Object.values(results)) {
      if (result.kind === 'client-failure') counts.clientFailures[result.failure.stage] += 1
      else if (result.response.ok) counts.telegramSuccesses += 1
      else counts.telegramApiErrors += 1
    }
    log({
      level: 'info',
      event: 'telegram_send_many_completed',
      totalRequested: entries.length,
      durationMs: Date.now() - startedAt,
      ...counts
    })
    return results
  }

  function register(command: TelegramCommandName, handler: TelegramCommandHandler): void {
    if (typeof command !== 'string' || !COMMAND_NAME.test(command)) {
      throw namedError(
        'TelegramCommandRegistrationError',
        'Telegram command must start with / and contain 1-32 letters, digits, or underscores.',
        'telegram_command_invalid'
      )
    }
    if (typeof handler !== 'function') {
      throw namedError(
        'TelegramCommandRegistrationError',
        'Telegram command handler must be a function.',
        'telegram_command_handler_invalid'
      )
    }
    const normalized = command.toLowerCase() as TelegramCommandName
    if (handlers.has(normalized)) {
      throw namedError(
        'TelegramCommandRegistrationError',
        `Telegram command ${normalized} is already registered.`,
        'telegram_command_duplicate'
      )
    }
    handlers.set(normalized, handler)
  }

  async function dispatch(rawMessage: unknown): Promise<TelegramCommandDispatchResult> {
    const startedAt = Date.now()
    let text = ''
    try {
      text = isObject(rawMessage) && typeof rawMessage.text === 'string'
        ? rawMessage.text
        : ''
    } catch {
      text = ''
    }
    const trimmedStart = text.trimStart()
    const rawCommand = trimmedStart.split(/\s+/, 1)[0] || ''
    if (!rawCommand.startsWith('/')) {
      log({
        level: 'info',
        event: 'telegram_command_unhandled',
        reason: 'not-a-command',
        durationMs: Date.now() - startedAt
      })
      return { kind: 'unhandled', reason: 'not-a-command' }
    }

    const problems = commandMessageProblem(rawMessage)
    if (problems.length) {
      const validationError = namedError(
        'TelegramMessageValidationError',
        'Invalid Telegram command message.',
        'telegram_command_message_invalid',
        { problems }
      )
      const validationFailure = failure('validation', validationError, secrets)
      log({
        level: 'error',
        event: 'telegram_command_validation_failed',
        telegramMessageId: safelyReadNumber(rawMessage, ['message_id']),
        chatId: safelyReadNumber(rawMessage, ['chat', 'id']),
        senderId: safelyReadNumber(rawMessage, ['from', 'id']),
        problems,
        payload: sanitizeTelegramValue(rawMessage, { secrets }),
        durationMs: Date.now() - startedAt
      })
      await reportResult({ kind: 'client-failure', failure: validationFailure }, 'commands.dispatch')
      return { kind: 'client-failure', failure: validationFailure }
    }

    const normalized = rawCommand.replace(/@[a-z0-9_]{1,32}$/i, '').toLowerCase()
    if (!COMMAND_TOKEN.test(rawCommand) || !COMMAND_NAME.test(normalized)) {
      log({
        level: 'info',
        event: 'telegram_command_unhandled',
        rawCommand,
        reason: 'unknown-command',
        durationMs: Date.now() - startedAt
      })
      return { kind: 'unhandled', reason: 'unknown-command' }
    }
    const command = normalized as TelegramCommandName
    const handler = handlers.get(command)
    if (!handler) {
      log({
        level: 'info',
        event: 'telegram_command_unhandled',
        command,
        rawCommand,
        chatId: safelyReadNumber(rawMessage, ['chat', 'id']),
        telegramMessageId: safelyReadNumber(rawMessage, ['message_id']),
        reason: 'unknown-command',
        durationMs: Date.now() - startedAt
      })
      return { kind: 'unhandled', reason: 'unknown-command' }
    }

    const message = rawMessage as Message.TextMessage
    const replies: SendOneResult[] = []
    const context: TelegramCommandContext = {
      message,
      command,
      rawCommand,
      argumentText: trimmedStart.slice(rawCommand.length).trim(),
      async reply(replyInput) {
        const result = await sendOne({
          ...replyInput,
          chatId: String(message.chat.id)
        })
        replies.push(result)
        return result
      }
    }

    try {
      await handler(context)
    } catch (error) {
      log({
        level: 'error',
        event: 'telegram_command_handler_failed',
        command,
        rawCommand,
        chatId: message.chat.id,
        telegramMessageId: message.message_id,
        durationMs: Date.now() - startedAt,
        internalError: sanitizeTelegramValue(error, { secrets })
      })
      throw error
    }

    log({
      level: 'info',
      event: 'telegram_command_handled',
      command,
      rawCommand,
      chatId: message.chat.id,
      telegramMessageId: message.message_id,
      replies: replies.length,
      durationMs: Date.now() - startedAt
    })
    return {
      kind: 'handled',
      command,
      replies
    }
  }

  return {
    sendOne,
    sendMany,
    commands: {
      register,
      dispatch
    }
  }
}

export type TelegramIntegration = ReturnType<typeof createTelegramIntegration>
