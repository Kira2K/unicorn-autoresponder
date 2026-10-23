import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTelegramIntegration } from './integration.ts'

test('document uses the shared multipart client and retains the complete response', async () => {
  const response = { ok: true, result: { message_id: 7, date: 1,
    chat: { id: -123, type: 'group' }, document: { file_id: 'file', file_unique_id: 'unique' }, future: true } }
  let calls = 0
  const api = createTelegramIntegration({ token: 'test', regularErrorChatId: '', summaryLogsChatId: '', logger() {},
    requester: async (url, options) => {
      calls++
      assert.ok(url.endsWith('/sendDocument'))
      assert.equal(options.headers, undefined)
      const form = options.body as FormData
      assert.equal(form.get('chat_id'), '-123')
      assert.equal(form.get('caption'), 'date\n#author\n\ncaption')
      assert.equal(await (form.get('document') as File).text(), 'cached bytes')
      return { ok: true, status: 200, async json() { return response } }
    } })
  assert.deepEqual(await api.sendOne({ chatId: '-123', text: 'date\n#author\n\ncaption',
    attachment: { file: new Blob(['cached bytes']), filename: 'archive.pdf' } }),
  { kind: 'telegram-response', response })
  assert.equal(calls, 1)
})

test('invalid document input never sends; uncertain transport does not retry', async () => {
  let calls = 0
  const api = createTelegramIntegration({ token: 'test', regularErrorChatId: '', summaryLogsChatId: '', logger() {},
    requester: async () => { calls++; throw new Error('connection lost') } })
  const invalid = await api.sendOne({ chatId: '-123', text: 'caption',
    attachment: { file: new Blob(['x']), filename: '../secret' } })
  assert.equal(invalid.kind, 'client-failure')
  assert.equal(calls, 0)
  const uncertain = await api.sendOne({ chatId: '-123', text: 'caption',
    attachment: { file: new Blob(['x']), filename: 'file.pdf' } })
  assert.equal(uncertain.kind, 'client-failure')
  assert.equal(calls, 1)
})
