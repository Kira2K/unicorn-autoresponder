const assert = require('node:assert/strict')

const { createTelegramIntegration } = require('./integration.ts') as
  typeof import('./integration.ts')

import type { ApiError, Message } from '@grammyjs/types'
import type {
  SendManyInput,
  SendOneInput,
  SendOneResult,
  TelegramCommandContext,
  TelegramCommandDispatchResult
} from './types.ts'

function message(overrides: Record<string, unknown> = {}): Message.TextMessage {
  return {
    message_id: 17,
    date: 1_700_000_000,
    chat: { id: -100123, type: 'supergroup', title: 'Test' },
    from: { id: 42, is_bot: false, first_name: 'User', username: 'UserName' },
    text: 'hello',
    ...overrides
  } as Message.TextMessage
}

function success(overrides: Record<string, unknown> = {}) {
  const result = {
    ...message(),
    text: 'sent',
    entities: [{ type: 'bold' as const, offset: 0, length: 4 }],
    reply_markup: { inline_keyboard: [] },
    unknown_future_field: { retained: true },
    ...overrides
  } as Message.TextMessage & Record<string, unknown>
  return {
    ok: true as const,
    result
  }
}

function requesterFor(value: unknown, calls: Array<Record<string, unknown>> = []) {
  return async (_url: string, options: Record<string, unknown>) => {
    calls.push(options)
    return {
      ok: true,
      status: 200,
      async json() { return value }
    }
  }
}

function quietOptions() {
  return {
    token: 'test-token',
    regularErrorChatId: '',
    summaryLogsChatId: '',
    logger() {}
  }
}

async function testSendOneSuccessAndPayload(): Promise<void> {
  const response = success()
  const calls: Array<Record<string, unknown>> = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    requester: requesterFor(response, calls)
  })
  const result = await telegram.sendOne({ chatId: ' -100123 ', text: '  keep spaces  ' })
  assert.equal(result.kind, 'telegram-response')
  if (result.kind !== 'telegram-response' || !result.response.ok) return
  assert.equal(result.response, response)
  assert.equal(result.response.result.message_id, 17)
  assert.equal(result.response.result.from?.username, 'UserName')
  assert.equal(result.response.result.chat.id, -100123)
  assert.ok('text' in result.response.result)
  if ('text' in result.response.result) assert.equal(result.response.result.text, 'sent')
  assert.deepEqual((result.response.result as unknown as Record<string, unknown>).unknown_future_field, {
    retained: true
  })
  const body = JSON.parse(String(calls[0].body))
  assert.equal(body.chat_id, '-100123')
  assert.equal(body.text, '  keep spaces  ')
  assert.equal(body.disable_web_page_preview, true)
  assert.equal('link_preview_options' in body, false)
}

async function testExplicitLinkPreviewOptions(): Promise<void> {
  const calls: Array<Record<string, unknown>> = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    requester: requesterFor(success(), calls)
  })
  await telegram.sendOne({
    chatId: '1',
    text: 'preview',
    linkPreviewOptions: { is_disabled: false, prefer_large_media: true }
  })
  const body = JSON.parse(String(calls[0].body))
  assert.deepEqual(body.link_preview_options, {
    is_disabled: false,
    prefer_large_media: true
  })
  assert.equal('disable_web_page_preview' in body, false)
}

async function testLongMessagesUseRichDelivery(): Promise<void> {
  const { yuliaReworkMessage } = require('./resume-provider-message-templates.ts')
  const card = yuliaReworkMessage('en', {
    clientName: 'Тестовый ученик', market: 'EN',
    education: 'Образование ученика. '.repeat(100),
    kirasComments: 'Исходный комментарий Киры. '.repeat(100)
  }, 'Причина возврата без сокращений.', 'https://example.invalid/returned')
  const native = { ok: true as const, result: {
    message_id: 18, date: 1_700_000_000,
    chat: { id: 1, type: 'private' as const, first_name: 'Test' },
    rich_message: { blocks: [{ type: 'paragraph' as const, text: 'complete response' }] },
    unknown_future_field: { retained: true }
  } }
  const calls: Array<{ url: string; body: Record<string, any> }> = []
  const events: unknown[] = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    logger(event) { events.push(event) },
    requester: async (url, options) => {
      calls.push({ url, body: JSON.parse(String(options.body)) })
      return { ok: true, status: 200, async json() { return native } }
    }
  })
  const markup = { inline_keyboard: [[{ text: 'Открыть', url: 'https://example.invalid/returned' }]] }
  const result = await telegram.sendOne({ chatId: '1', ...card, replyMarkup: markup, messageThreadId: 3 })
  assert.equal(result.kind, 'telegram-response')
  if (result.kind !== 'telegram-response' || !result.response.ok) return
  assert.equal(result.response, native, 'native Rich Message response must not be remapped')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/sendRichMessage'))
  assert.equal(calls[0].body.chat_id, '1')
  assert.equal(calls[0].body.message_thread_id, 3)
  assert.deepEqual(calls[0].body.reply_markup, markup)
  assert.ok(!('text' in calls[0].body))
  assert.ok(!('parse_mode' in calls[0].body))
  assert.equal(calls[0].body.rich_message.html, card.text.replace(/\n/g, '<br>'))
  assert.ok(calls[0].body.rich_message.html.includes('https://example.invalid/returned'))
  assert.ok(!JSON.stringify(events).includes('Образование ученика.'))
  assert.ok(!JSON.stringify(events).includes('telegram_send_one_invalid_response'))

  calls.length = 0
  const literal = '<not HTML> & *not Markdown*\n' + 'x'.repeat(4097)
  await telegram.sendOne({ chatId: '1', text: literal })
  assert.ok(calls[0].url.endsWith('/sendRichMessage'))
  assert.deepEqual(calls[0].body.rich_message.blocks, [{ type: 'paragraph', text: literal }])
}

async function testRichDeliveryBoundariesAndFailures(): Promise<void> {
  const calls: Array<{ url: string; body: Record<string, any> }> = []
  const telegram = createTelegramIntegration({ ...quietOptions(), requester: async (url, options) => {
    calls.push({ url, body: JSON.parse(String(options.body)) })
    return { ok: true, status: 200, async json() { return success() } }
  } })
  for (const input of [
    { text: 'x'.repeat(4096) },
    { text: '<b>' + 'x'.repeat(4096) + '</b>', parseMode: 'HTML' as const },
    { text: '&amp;'.repeat(4096), parseMode: 'HTML' as const },
    { text: '<a href="https://example.invalid/' + 'q'.repeat(5000) + '">файл</a>', parseMode: 'HTML' as const },
    { text: 'x'.repeat(4097), parseMode: 'MarkdownV2' as const }
  ]) {
    calls.length = 0
    await telegram.sendOne({ chatId: '1', ...input })
    assert.ok(calls[0].url.endsWith('/sendMessage'), 'short rendered text and legacy Markdown stay unchanged')
    assert.equal(calls[0].body.text, input.text)
  }
  calls.length = 0
  const sourceHtml = '<b>Карточка</b>\n<pre>строка 1\nстрока 2</pre>\n<code>a\nb</code>\n' + 'x'.repeat(4097)
  await telegram.sendOne({ chatId: '1', text: sourceHtml, parseMode: 'HTML' })
  assert.equal(calls[0].body.rich_message.html,
    '<b>Карточка</b><br><pre>строка 1\nстрока 2</pre><br><code>a\nb</code><br>' + 'x'.repeat(4097))
  calls.length = 0
  await telegram.sendOne({ chatId: '1', text: '&#x1f600;'.repeat(4096), parseMode: 'HTML' })
  assert.ok(calls[0].url.endsWith('/sendMessage'), 'count parsed Unicode characters, not HTML bytes')
  calls.length = 0
  await telegram.sendOne({ chatId: '1', text: 'x'.repeat(32768) })
  assert.ok(calls[0].url.endsWith('/sendRichMessage'))
  calls.length = 0
  const overflow = await telegram.sendOne({ chatId: '1', text: 'x'.repeat(32769) })
  assert.equal(overflow.kind, 'client-failure')
  if (overflow.kind === 'client-failure') assert.equal(overflow.failure.stage, 'validation')
  assert.equal(calls.length, 0, 'do not truncate or send a known oversized Rich Message')

  let attempts = 0
  const unknown = createTelegramIntegration({ ...quietOptions(), requester: async () => {
    attempts += 1
    throw new Error('Response lost after send')
  } })
  const lost = await unknown.sendOne({ chatId: '1', text: 'x'.repeat(5000) })
  assert.equal(lost.kind, 'client-failure')
  if (lost.kind === 'client-failure') assert.equal(lost.failure.stage, 'transport')
  assert.equal(attempts, 1, 'never fall back to a second send after an unknown result')

  attempts = 0
  const apiError = { ok: false, error_code: 400, description: 'Rich message rejected', parameters: { retry_after: 5 } }
  const rejected = createTelegramIntegration({ ...quietOptions(), requester: async () => {
    attempts += 1
    return { ok: false, status: 400, async json() { return apiError } }
  } })
  const errorResult = await rejected.sendOne({ chatId: '1', text: 'x'.repeat(5000) })
  assert.equal(errorResult.kind, 'telegram-response')
  if (errorResult.kind === 'telegram-response') assert.equal(errorResult.response, apiError)
  assert.equal(attempts, 1)
}

async function testNativeApiErrors(): Promise<void> {
  for (const errorCode of [400, 401, 403, 429, 500]) {
    const response = {
      ok: false as const,
      error_code: errorCode,
      description: `Telegram error ${errorCode}`,
      parameters: { retry_after: 3, migrate_to_chat_id: -100999, nonstandard: ['kept'] },
      unknown_future_field: 'kept'
    }
    const telegram = createTelegramIntegration({
      ...quietOptions(),
      requester: requesterFor(response)
    })
    const result = await telegram.sendOne({ chatId: '1', text: 'hello' })
    assert.equal(result.kind, 'telegram-response')
    if (result.kind !== 'telegram-response') continue
    assert.equal(result.response, response)
    assert.equal(result.response.ok, false)
    if (result.response.ok) continue
    assert.equal(result.response.error_code, errorCode)
    assert.equal(result.response.parameters?.retry_after, 3)
    assert.deepEqual(
      (result.response.parameters as unknown as Record<string, unknown>).nonstandard,
      ['kept']
    )
  }
}

async function testValidationAndConfiguration(): Promise<void> {
  let requests = 0
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    requester: async () => {
      requests += 1
      return { ok: true, status: 200, async json() { return success() } }
    }
  })
  const invalid = await telegram.sendOne({ chatId: '', text: '' } as SendOneInput)
  assert.equal(invalid.kind, 'client-failure')
  if (invalid.kind === 'client-failure') assert.equal(invalid.failure.stage, 'validation')
  assert.equal(requests, 0)

  const missing = createTelegramIntegration({
    ...quietOptions(),
    token: '',
    requester: requesterFor(success())
  })
  const missingResult = await missing.sendOne({ chatId: '1', text: 'hello' })
  assert.equal(missingResult.kind, 'client-failure')
  if (missingResult.kind === 'client-failure') {
    assert.equal(missingResult.failure.stage, 'configuration')
    assert.equal(missingResult.failure.error.code, 'telegram_bot_token_missing')
  }
}

async function testTransportAndTimeout(): Promise<void> {
  const rejections: unknown[] = [
    'socket vanished',
    Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' }),
    Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
  ]
  for (const rejection of rejections) {
    const rejected = createTelegramIntegration({
      ...quietOptions(),
      requester: async () => { throw rejection }
    })
    const rejectedResult = await rejected.sendOne({ chatId: '1', text: 'hello' })
    assert.equal(rejectedResult.kind, 'client-failure')
    if (rejectedResult.kind === 'client-failure') {
      assert.equal(rejectedResult.failure.stage, 'transport')
    }
  }

  const timeout = createTelegramIntegration({
    ...quietOptions(),
    requestTimeoutMs: 5,
    requester: async (_url, options) => await new Promise((_resolve, reject) => {
      const signal = options.signal as AbortSignal
      signal.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    })
  })
  const timeoutResult = await timeout.sendOne({ chatId: '1', text: 'hello' })
  assert.equal(timeoutResult.kind, 'client-failure')
  if (timeoutResult.kind === 'client-failure') {
    assert.equal(timeoutResult.failure.stage, 'transport')
  }
}

async function testInvalidResponses(): Promise<void> {
  const invalidValues: unknown[] = [
    null,
    [],
    'html',
    42,
    {},
    { ok: 'true', result: {} },
    { ok: true, result: { message_id: 1 } },
    { ok: true, result: { ...message(), text: undefined, rich_message: { blocks: [] } } },
    { ok: true, result: { ...message(), text: undefined, rich_message: { blocks: [null] } } },
    { ok: true, result: { ...message(), text: undefined, rich_message: { blocks: [{ type: 42 }] } } },
    { ok: false, error_code: 400 },
    { ok: false, description: 'missing code' }
  ]
  for (const value of invalidValues) {
    const telegram = createTelegramIntegration({
      ...quietOptions(),
      requester: requesterFor(value)
    })
    const result = await telegram.sendOne({ chatId: '1', text: 'hello' })
    assert.equal(result.kind, 'client-failure')
    if (result.kind === 'client-failure') assert.equal(result.failure.stage, 'response')
  }

  for (const status of [200, 400, 502]) {
    const telegram = createTelegramIntegration({
      ...quietOptions(),
      requester: async () => ({
        ok: status < 400,
        status,
        async json() { throw new SyntaxError('<html>bad gateway</html>') }
      })
    })
    const result = await telegram.sendOne({ chatId: '1', text: 'hello' })
    assert.equal(result.kind, 'client-failure')
    if (result.kind === 'client-failure') assert.equal(result.failure.stage, 'response')
  }
}

async function testUnexpectedAndLoggerFailures(): Promise<void> {
  const circular: { cause?: unknown } = {}
  circular.cause = circular
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    logger() { throw new Error('logger unavailable') },
    botApi: {
      async sendMessageResponse() {
        throw Object.assign(new Error('strange internal failure'), { details: circular })
      }
    }
  })
  const result = await telegram.sendOne({ chatId: '1', text: 'hello' })
  assert.equal(result.kind, 'client-failure')
  if (result.kind === 'client-failure') assert.equal(result.failure.stage, 'internal')
  assert.doesNotThrow(() => JSON.stringify(result))
}

async function testReportingCannotRecurse(): Promise<void> {
  const urls: string[] = []
  const responses = [
    { ok: false, error_code: 400, description: 'original failure' },
    { ok: false, error_code: 400, description: 'reporting failure' }
  ]
  const telegram = createTelegramIntegration({
    token: 'secret-token',
    regularErrorChatId: '-5216637594',
    summaryLogsChatId: '-1003187558078',
    logger() {},
    requester: async url => {
      urls.push(url)
      const value = responses.shift()
      return { ok: true, status: 200, async json() { return value } }
    }
  })
  const result = await telegram.sendOne({ chatId: '1', text: 'hello' })
  assert.equal(result.kind, 'telegram-response')
  assert.equal(urls.length, 2)
  assert(urls.every(url => url.includes('secret-token')))

  let calls = 0
  const reporterThrows = createTelegramIntegration({
    token: 'secret-token',
    regularErrorChatId: '-5216637594',
    summaryLogsChatId: '-1003187558078',
    logger() {},
    botApi: {
      async sendMessageResponse() {
        calls += 1
        if (calls === 1) return { ok: false, error_code: 500, description: 'original' }
        throw new Error('remote reporter unavailable')
      }
    }
  })
  const originalResult = await reporterThrows.sendOne({ chatId: '1', text: 'hello' })
  assert.equal(calls, 2)
  assert.deepEqual(originalResult, {
    kind: 'telegram-response',
    response: { ok: false, error_code: 500, description: 'original' }
  })
}

async function testTokenNeverLogged(): Promise<void> {
  const events: unknown[] = []
  const telegram = createTelegramIntegration({
    token: 'very-secret-token',
    regularErrorChatId: '',
    summaryLogsChatId: '',
    logger(event) { events.push(event) },
    botApi: {
      async sendMessageResponse() {
        throw new Error('failed at https://api.telegram.org/botvery-secret-token/sendMessage')
      }
    }
  })
  await telegram.sendOne({ chatId: '1', text: 'top secret outgoing message' })
  const logged = JSON.stringify(events)
  assert.equal(logged.includes('very-secret-token'), false)
  assert.equal(logged.includes('top secret outgoing message'), false)
  assert(logged.includes('textLength'))
}

async function testSendMany(): Promise<void> {
  const attempted: string[] = []
  const delays: number[] = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    batchDelayMs: 2000,
    delay: async milliseconds => { delays.push(milliseconds) },
    batchSendOne: async input => {
      attempted.push(input.chatId)
      if (input.chatId === '2') throw new Error('unexpected item failure')
      if (input.chatId === '3') {
        return {
          kind: 'client-failure',
          failure: {
            stage: 'transport',
            error: { name: 'Error', message: 'network' }
          }
        }
      }
      return { kind: 'telegram-response', response: success({ text: input.text }) }
    }
  })
  const input: SendManyInput = {
    first: { text: 'one' },
    '2': { text: 'two' },
    '3': { text: 'three' },
    last: { text: 'four' }
  }
  const result = await telegram.sendMany(input)
  assert.deepEqual(attempted, Object.keys(input))
  assert.deepEqual(delays, [2000, 2000, 2000])
  assert.deepEqual(Object.keys(result), Object.keys(input))
  assert.equal(result['2'].kind, 'client-failure')
  if (result['2'].kind === 'client-failure') {
    assert.equal(result['2'].failure.stage, 'internal')
  }
  assert.equal(result.last.kind, 'telegram-response')
}

async function testCommands(): Promise<void> {
  const sent: string[] = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    botApi: {
      async sendMessageResponse(input) {
        sent.push(input.text)
        return success({ text: input.text })
      }
    }
  })
  let seenUnknownField: unknown
  let immediate: SendOneResult | undefined
  telegram.commands.register('/mentor', async context => {
    seenUnknownField = (context.message as unknown as Record<string, unknown>).future_field
    assert.equal(context.command, '/mentor')
    assert.equal(context.rawCommand, '/MeNtOr@veu_support_bot')
    assert.equal(context.argumentText, 'hello world')
    immediate = await context.reply({ text: 'reply now' })
    assert.equal(sent.length, 1)
  })
  const result = await telegram.commands.dispatch(message({
    text: '  /MeNtOr@veu_support_bot   hello world  ',
    future_field: { retained: true }
  }))
  assert.equal(result.kind, 'handled')
  if (result.kind === 'handled') {
    assert.equal(result.command, '/mentor')
    assert.equal(result.replies.length, 1)
    assert.equal(result.replies[0], immediate)
  }
  assert.deepEqual(seenUnknownField, { retained: true })
  assert.equal(sent.length, 1)

  assert.deepEqual(
    await telegram.commands.dispatch(message({ text: 'ordinary text' })),
    { kind: 'unhandled', reason: 'not-a-command' }
  )
  assert.deepEqual(
    await telegram.commands.dispatch(message({ text: '/unknown' })),
    { kind: 'unhandled', reason: 'unknown-command' }
  )
  assert.throws(
    () => telegram.commands.register('/MENTOR', async () => undefined),
    (error: unknown) => error instanceof Error &&
      (error as Error & { code?: string }).code === 'telegram_command_duplicate'
  )
  assert.throws(
    () => telegram.commands.register('mentor' as `/${string}`, async () => undefined),
    (error: unknown) => error instanceof Error &&
      (error as Error & { code?: string }).code === 'telegram_command_invalid'
  )
  assert.throws(
    () => telegram.commands.register('/bad', null as unknown as () => Promise<void>),
    (error: unknown) => error instanceof Error &&
      (error as Error & { code?: string }).code === 'telegram_command_handler_invalid'
  )

  const failingReply = createTelegramIntegration({
    ...quietOptions(),
    botApi: {
      async sendMessageResponse() {
        return { ok: false, error_code: 403, description: 'Forbidden' }
      }
    }
  })
  let replySeenByHandler: SendOneResult | undefined
  failingReply.commands.register('/fail', async context => {
    replySeenByHandler = await context.reply({ text: 'will fail' })
  })
  const failedDispatch = await failingReply.commands.dispatch(message({ text: '/fail' }))
  assert.equal(failedDispatch.kind, 'handled')
  if (failedDispatch.kind === 'handled') {
    assert.equal(failedDispatch.replies.length, 1)
    assert.equal(failedDispatch.replies[0], replySeenByHandler)
    assert.equal(failedDispatch.replies[0].kind, 'telegram-response')
  }
}

async function testMalformedCommandAndHandlerFailure(): Promise<void> {
  const events: unknown[] = []
  const telegram = createTelegramIntegration({
    ...quietOptions(),
    logger(event) { events.push(event) }
  })
  let calls = 0
  telegram.commands.register('/test', async () => { calls += 1 })
  const circular: Record<string, unknown> = {
    text: '/test',
    message_id: 'bad',
    date: 1,
    chat: { id: 1, type: 'private' },
    authorization: 'secret',
    oversized: 'x'.repeat(2000),
    array: Array.from({ length: 100 }, (_, index) => index)
  }
  circular.self = circular
  const malformed = await telegram.commands.dispatch(circular)
  assert.equal(malformed.kind, 'client-failure')
  if (malformed.kind === 'client-failure') {
    assert.equal(malformed.failure.stage, 'validation')
    assert.equal(malformed.failure.error.name, 'TelegramMessageValidationError')
  }
  assert.equal(calls, 0)
  const logged = JSON.stringify(events)
  assert.equal(logged.includes('secret'), false)
  assert(logged.includes('[Circular]'))
  assert(logged.includes('[Truncated]'))

  const uninspectable = new Proxy({}, {
    ownKeys() { throw new Error('sanitizer trap') }
  })
  assert.doesNotThrow(() => JSON.stringify(sanitizeForTest(uninspectable)))

  const brokenValidationLogger = createTelegramIntegration({
    ...quietOptions(),
    logger() { throw new Error('validation logger unavailable') }
  })
  const loggerFailureResult = await brokenValidationLogger.commands.dispatch({
    text: '/test',
    message_id: 'invalid',
    date: 1,
    chat: { id: 1, type: 'private' }
  })
  assert.equal(loggerFailureResult.kind, 'client-failure')
  if (loggerFailureResult.kind === 'client-failure') {
    assert.equal(loggerFailureResult.failure.stage, 'validation')
  }

  const throwing = createTelegramIntegration(quietOptions())
  throwing.commands.register('/throw', async () => { throw new Error('business failure') })
  await assert.rejects(
    throwing.commands.dispatch(message({ text: '/throw' })),
    /business failure/
  )
}

function sanitizeForTest(value: unknown): unknown {
  const { sanitizeTelegramValue } = require('./sanitize.ts') as typeof import('./sanitize.ts')
  return sanitizeTelegramValue(value)
}

function compileTimeContract(
  result: SendOneResult,
  dispatchResult: TelegramCommandDispatchResult
): void {
  if (result.kind === 'client-failure') {
    const stage: 'validation' | 'configuration' | 'transport' | 'response' | 'internal' =
      result.failure.stage
    void stage
  } else if (result.response.ok) {
    const telegramMessage: Message.TextMessage | Message.RichMessageMessage = result.response.result
    const messageId: number = telegramMessage.message_id
    const chatType: string = telegramMessage.chat.type
    void messageId
    void chatType
  } else {
    const apiError: ApiError = result.response
    const retryAfter: number | undefined = apiError.parameters?.retry_after
    void retryAfter
  }
  if (dispatchResult.kind === 'handled') {
    const replies: readonly SendOneResult[] = dispatchResult.replies
    void replies
  }
}
void compileTimeContract

function compileTimeCommandContext(context: TelegramCommandContext): void {
  const originalMessage: Readonly<Message.TextMessage> = context.message
  const replyResult: Promise<SendOneResult> = context.reply({ text: 'typed reply' })
  void originalMessage
  void replyResult
}
void compileTimeCommandContext

async function runTests(): Promise<void> {
  await testSendOneSuccessAndPayload()
  await testExplicitLinkPreviewOptions()
  await testLongMessagesUseRichDelivery()
  await testRichDeliveryBoundariesAndFailures()
  await testNativeApiErrors()
  await testValidationAndConfiguration()
  await testTransportAndTimeout()
  await testInvalidResponses()
  await testUnexpectedAndLoggerFailures()
  await testReportingCannotRecurse()
  await testTokenNeverLogged()
  await testSendMany()
  await testCommands()
  await testMalformedCommandAndHandlerFailure()
  console.log('telegram integration tests passed')
}

runTests().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
