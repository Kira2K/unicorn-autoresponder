import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTelegramIntegration } from './integration.ts'

const quiet = { regularErrorChatId: '', summaryLogsChatId: '', logger() {} }

test('editing uses the shared client, preserves the message ID and native response', async () => {
  const markup = { inline_keyboard: [[{ text: 'Approve', callback_data: 'current-revision' }]] }
  const response = { ok: true, result: { message_id: 7, date: 1, edit_date: 2,
    chat: { id: -123, type: 'supergroup' }, text: 'replacement', reply_markup: markup, future: true } }
  let calls = 0
  const api = createTelegramIntegration({ ...quiet, token: 'test', requester: async (url, options) => {
    calls++
    assert.ok(url.endsWith('/editMessageText'))
    assert.deepEqual(JSON.parse(String(options.body)), { chat_id: '-123', message_id: 7, text: 'replacement', reply_markup: markup })
    return { ok: true, status: 200, async json() { return response } }
  } })
  assert.deepEqual(await api.sendOne({ chatId: '-123', editMessageId: 7, text: 'replacement', replyMarkup: markup }),
    { kind: 'telegram-response', response })
  assert.equal(calls, 1)
})

test('invalid edits never call the requester; legacy adapters cannot accidentally create a new message', async () => {
  let calls = 0
  const api = createTelegramIntegration({ ...quiet, botApi: { async sendMessageResponse() { calls++; return {} } } })
  for (const editMessageId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null]) {
    const result = await api.sendOne({ chatId: '-123', text: 'replacement', editMessageId } as any)
    assert.equal(result.kind, 'client-failure')
  }
  for (const extra of [{ attachment: { fileName: 'file.pdf', mimeType: 'application/pdf' as const, data: new Uint8Array([1]) } },
    { messageThreadId: 2 }, { replyMarkup: { remove_keyboard: true as const } }]) {
    const result = await api.sendOne({ chatId: '-123', text: 'replacement', editMessageId: 7, ...extra })
    assert.equal(result.kind, 'client-failure')
  }
  const unavailable = await api.sendOne({ chatId: '-123', text: 'replacement', editMessageId: 7 })
  assert.equal(unavailable.kind, 'client-failure')
  if (unavailable.kind === 'client-failure') assert.equal(unavailable.failure.stage, 'configuration')
  assert.equal(calls, 0)
})

test('editing errors and uncertain results never retry or create a replacement post', async () => {
  for (const error of [false, true]) {
    let calls = 0
    const response = { ok: false, error_code: 400, description: 'message is not modified' }
    const api = createTelegramIntegration({ ...quiet, token: 'test', requester: async url => {
      calls++; assert.ok(url.endsWith('/editMessageText'))
      if (error) throw Error('connection lost after request')
      return { ok: false, status: 400, async json() { return response } }
    } })
    const result = await api.sendOne({ chatId: '-123', text: 'replacement', editMessageId: 7 })
    if (error) {
      assert.equal(result.kind, 'client-failure')
      if (result.kind === 'client-failure') assert.equal(result.failure.stage, 'transport')
    } else assert.deepEqual(result, { kind: 'telegram-response', response })
    assert.equal(calls, 1)
  }
})

test('long edits use rich content in one edit request', async () => {
  const text = 'long content '.repeat(400)
  let calls = 0
  const api = createTelegramIntegration({ ...quiet, token: 'test', requester: async (url, options) => {
    calls++; assert.ok(url.endsWith('/editMessageText'))
    const body = JSON.parse(String(options.body))
    assert.equal(body.message_id, 7)
    assert.equal(body.text, undefined)
    assert.equal(body.rich_message.blocks[0].text, text)
    return { ok: true, status: 200, async json() { return { ok: true, result: {
      message_id: 7, date: 1, chat: { id: -123, type: 'group' }, rich_message: body.rich_message } } } }
  } })
  const result = await api.sendOne({ chatId: '-123', text, editMessageId: 7 })
  assert.equal(result.kind, 'telegram-response')
  assert.equal(calls, 1)
})
