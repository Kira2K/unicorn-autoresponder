import assert from 'node:assert/strict'
import test from 'node:test'

import type { SendOneResult } from '../../../../src/integrations/telegram/types.ts'
import {
  decodeManagerSendPayload,
  normalizeLinkedCommonChatId,
  runManagerSend,
  summarizeSendOne
} from './send.ts'

test('canonicalizes linked common group chat ids and rejects unrelated values', () => {
  assert.equal(normalizeLinkedCommonChatId(' 5216637594 '), '-5216637594')
  assert.equal(normalizeLinkedCommonChatId('-1004450078294'), '-1004450078294')
  assert.throws(() => normalizeLinkedCommonChatId('0'), /common_chat_id_invalid/)
  assert.throws(() => normalizeLinkedCommonChatId(5216637594), /common_chat_id_invalid/)
})

function success(chatId = '42', messageId = 7): SendOneResult {
  return {
    kind: 'telegram-response',
    response: {
      ok: true,
      result: {
        message_id: messageId,
        date: 1,
        chat: { id: Number(chatId), type: 'private', first_name: 'Test' },
        text: 'secret outgoing text'
      }
    }
  }
}

test('decodes an approved payload without accepting malformed preview ids', () => {
  const payload = {
    previewId: 'TG-A1B2C3D4',
    operation: 'sendOne',
    input: { chatId: '-42', text: 'hello' }
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  assert.deepEqual(decodeManagerSendPayload(encoded), payload)
  assert.throws(
    () => decodeManagerSendPayload(Buffer.from(JSON.stringify({ ...payload, previewId: 'bad' })).toString('base64')),
    /telegram_manager_payload_invalid/
  )
  assert.throws(
    () => decodeManagerSendPayload(Buffer.from(JSON.stringify({
      ...payload,
      input: { chatId: '42', text: 'hello' }
    })).toString('base64')),
    /telegram_manager_payload_invalid/
  )
})

test('sends one item once and returns safe success evidence without message text', async () => {
  const calls: unknown[] = []
  const output = await runManagerSend({
    previewId: 'TG-A1B2C3D4',
    operation: 'sendOne',
    input: { chatId: '42', text: 'secret outgoing text' }
  }, {
    async sendOne(input) {
      calls.push(input)
      return success()
    },
    async sendMany() {
      throw new Error('unexpected sendMany')
    }
  })

  assert.deepEqual(calls, [{ chatId: '42', text: 'secret outgoing text' }])
  assert.deepEqual(output, {
    previewId: 'TG-A1B2C3D4',
    operation: 'sendOne',
    result: { kind: 'telegram-response', ok: true, chatId: '42', messageId: 7 }
  })
  assert.doesNotMatch(JSON.stringify(output), /secret outgoing text/)
})

test('preserves Telegram error and client-failure classifications', () => {
  assert.deepEqual(summarizeSendOne({
    kind: 'telegram-response',
    response: {
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 3 }
    }
  }), {
    kind: 'telegram-response',
    ok: false,
    errorCode: 429,
    description: 'Too Many Requests',
    retryAfter: 3
  })

  assert.deepEqual(summarizeSendOne({
    kind: 'client-failure',
    failure: {
      stage: 'transport',
      error: { name: 'Error', message: 'offline', code: 'ECONNRESET' }
    }
  }), {
    kind: 'client-failure',
    stage: 'transport',
    error: { name: 'Error', message: 'offline', code: 'ECONNRESET' }
  })
})

test('summarizes every sendMany item', async () => {
  const output = await runManagerSend({
    previewId: 'TG-A1B2C3D4',
    operation: 'sendMany',
    input: { '42': { text: 'one' }, '43': { text: 'two' } }
  }, {
    async sendOne() {
      throw new Error('unexpected sendOne')
    },
    async sendMany() {
      return {
        '42': success('42', 1),
        '43': {
          kind: 'client-failure',
          failure: { stage: 'response', error: { name: 'Error', message: 'bad body' } }
        }
      }
    }
  })

  assert.deepEqual(output, {
    previewId: 'TG-A1B2C3D4',
    operation: 'sendMany',
    results: {
      '42': { kind: 'telegram-response', ok: true, chatId: '42', messageId: 1 },
      '43': {
        kind: 'client-failure',
        stage: 'response',
        error: { name: 'Error', message: 'bad body' }
      }
    }
  })
})
