const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createCrmIssueCallbackForwarder, CRM_CALLBACK_UNAVAILABLE } = require('./crm-issue-callback.ts')
const { runSupportBot } = require('./support-bot.ts')
const net = require('node:net')
// Every external transport is injected. Even accidental native I/O must fail.
net.Socket.prototype.connect = () => { throw new Error('test_network_forbidden') }
globalThis.fetch = (() => { throw new Error('test_fetch_forbidden') }) as typeof fetch
const secret = 'synthetic204_callback_secret_never_production'
const endpoint = 'https://crm.invalid/integrations/telegram/account-issues/'
const update = { update_id: 401, callback_query: { id: 'cb401', data: 'ci:1234:original', from: { id: 7, is_bot: false }, message: { chat: { id: -204 } } } }
const reply = (overrides = {}) => new Response(JSON.stringify({ method: 'answerCallbackQuery', callback_query_id: 'cb401', text: 'Готово. Фермер проверит.', ...overrides }))
const options = (requester: any, extra = {}) => ({ enabled: true, endpoint, secret, requester, ...extra })
async function call(handler: any, input = update) {
  const answers: any[] = []
  const result = await handler(input, { answerCallbackQuery: async (v: any) => { answers.push(v) } })
  return { result, answers }
}

test('non-ci callbacks leave the resume path and transport untouched', async () => {
  const handler = createCrmIssueCallbackForwarder(options(() => assert.fail('unexpected CRM')))
  assert.deepEqual(await call(handler, { ...update, callback_query: { ...update.callback_query, data: 'cv:advance:42' } }), { result: { handled: false }, answers: [] })
})
test('forwards original complete update and relays one exact answer', async () => {
  let requests = 0
  const handler = createCrmIssueCallbackForwarder(options(async (url: string, request: any) => {
    requests++; assert.equal(url, endpoint); assert.equal(request.redirect, 'error')
    assert.equal(request.headers['X-Telegram-Bot-Api-Secret-Token'], secret)
    assert.deepEqual(JSON.parse(request.body), update)
    return reply()
  }))
  const value = await call(handler)
  assert.equal(requests, 1); assert.equal(value.result.outcome, 'crm_answer_received')
  assert.deepEqual(value.answers, [{ callbackQueryId: 'cb401', text: 'Готово. Фермер проверит.' }])
})
test('disabled mode does not dispatch or fall into generic resume callback', async () => {
  const handler = createCrmIssueCallbackForwarder({ enabled: false, requester: () => assert.fail('disabled request') })
  const value = await call(handler)
  assert.deepEqual(value.result, { handled: true, outcome: 'disabled' })
  assert.equal(value.answers[0].text, CRM_CALLBACK_UNAVAILABLE)
})
test('invalid TLS route/credentials are rejected without echoing secret', () => {
  for (const url of ['http://crm.invalid/integrations/telegram/account-issues/', endpoint + '?x=1', 'https://u:p@crm.invalid/integrations/telegram/account-issues/', 'https://crm.invalid/other/']) {
    assert.throws(() => createCrmIssueCallbackForwarder(options(() => undefined, { endpoint: url })), /^Error: crm_callback_configuration_invalid$/)
  }
  assert.throws(() => createCrmIssueCallbackForwarder(options(() => undefined, { secret: 'short' })), /configuration_invalid/)
})
test('request byte ceiling rejects before HTTP', async () => {
  const handler = createCrmIssueCallbackForwarder(options(() => assert.fail('oversize dispatch')))
  const value = await call(handler, { ...update, padding: 'я'.repeat(9000) } as any)
  assert.equal(value.result.outcome, 'unavailable')
})
test('unknown response ID/method/shape never answers a foreign callback', async () => {
  for (const response of [reply({ callback_query_id: 'foreign' }), reply({ method: 'sendMessage' }), new Response('null'), new Response('{invalid'), reply({ text: 'x'.repeat(201) })]) {
    const value = await call(createCrmIssueCallbackForwarder(options(async () => response)))
    assert.equal(value.result.outcome, 'unavailable')
    assert.deepEqual(value.answers, [{ callbackQueryId: 'cb401', text: CRM_CALLBACK_UNAVAILABLE }])
  }
})
test('bounded streaming response is cancelled once it exceeds4096bytes', async () => {
  let cancelled = false
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4097)) }, cancel() { cancelled = true } })
  const value = await call(createCrmIssueCallbackForwarder(options(async () => new Response(body))))
  assert.equal(value.result.outcome, 'unavailable'); assert.equal(cancelled, true)
})
test('Content-Length ceiling avoids consuming excessive response', async () => {
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true } })
  const value = await call(createCrmIssueCallbackForwarder(options(async () => new Response(body, { headers: { 'content-length': '99999' } }))))
  assert.equal(value.result.outcome, 'unavailable'); assert.equal(cancelled, true)
})
test('uncertain transport is attempted once, with no automatic mutation retry', async () => {
  let attempts = 0
  const handler = createCrmIssueCallbackForwarder(options(async () => { attempts++; throw new Error('contains synthetic secret ' + secret) }))
  const value = await call(handler)
  assert.equal(attempts, 1); assert.equal(value.result.outcome, 'unavailable')
  assert.equal(JSON.stringify(value).includes(secret), false)
})
test('deadline bounds a stalled fetch or response stream', async () => {
  for (const requester of [async () => new Promise(() => undefined), async () => new Response(new ReadableStream())]) {
    const started = Date.now()
    const value = await call(createCrmIssueCallbackForwarder(options(requester, { timeoutMs: 20 })))
    assert.equal(value.result.outcome, 'unavailable'); assert.ok(Date.now() - started < 1000)
  }
})
test('failed answer remains handled, avoiding duplicate generic error chat', async () => {
  const handler = createCrmIssueCallbackForwarder({ enabled: false })
  assert.deepEqual(await handler(update, { answerCallbackQuery: async () => { throw new Error('expired') } }), { handled: true, outcome: 'callback_answer_unconfirmed' })
})
test('real polling processes ci once, preserves next offset and following ordinary command', async () => {
  const stop = new AbortController(); const offsets: unknown[] = []; const answers: any[] = []; const messages: any[] = []
  let polls = 0
  const crmIssueForwarder = createCrmIssueCallbackForwarder(options(async () => reply()))
  await runSupportBot({
    initialOffset: 400, pollTimeout: 0, stopSignal: stop.signal, idleDelayMs: 0, crmIssueForwarder,
    apiClient: { backendStatus: async () => ({ ok: true }) },
    botApi: {
      getUpdates: async (offset: any) => { offsets.push(offset); polls++; assert.ok(polls <= 2, 'bounded test polling'); return polls === 1 ? [update] : [{ update_id: 402, message: { message_id: 402, date: 1793664000, text: '/backend_status', chat: { id: -204, type: 'supergroup' }, from: { id: 7 } } }] },
      answerCallbackQuery: async (v: any) => { answers.push(v) },
      sendMessage: async (v: any) => { messages.push(v); stop.abort() }
    }
  })
  assert.deepEqual(offsets, [400, 402]); assert.equal(answers.length, 1); assert.equal(messages.length, 1)
  assert.equal(messages[0].text, 'Бэкенд: работает')
})
test('real polling leaves non-ci callbacks in the original generic handler', async () => {
  const stop = new AbortController(); const answers: any[] = []; let called = false
  await runSupportBot({
    pollTimeout: 0, stopSignal: stop.signal, apiClient: {},
    crmIssueForwarder: async () => { called = true; return { handled: false } },
    botApi: {
      getUpdates: async () => [{ update_id: 403, callback_query: { id: 'resume403', data: 'unknown-resume', from: { id: 7 }, message: { chat: { id: -204 } } } }],
      answerCallbackQuery: async (v: any) => { answers.push(v); stop.abort() },
      sendMessage: async () => assert.fail('unexpected chat message')
    }
  })
  assert.equal(called, true); assert.deepEqual(answers, [{ callbackQueryId: 'resume403' }])
})
