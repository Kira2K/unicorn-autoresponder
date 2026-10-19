const assert = require('node:assert/strict')
const { test } = require('node:test')
const { selectTelegramGroupChatId } = require('./telegram-group-chat.ts') as {
  selectTelegramGroupChatId(client?: { secured_general_chat_id?: unknown; telegram_general_chat_id?: unknown } | null, fallback?: unknown): unknown
}

test('secured destination wins; only an empty secured field permits legacy fallback', () => {
  for (const secured of [undefined, null, '', '  \t\n']) {
    assert.equal(selectTelegramGroupChatId({ secured_general_chat_id: secured, telegram_general_chat_id: '-12' }), '-12')
  }
  for (const secured of [' -10034 ', '-1.0034e4', 'malformed', 0]) {
    assert.equal(selectTelegramGroupChatId({ secured_general_chat_id: secured, telegram_general_chat_id: '-12' }), secured)
  }
  assert.equal(selectTelegramGroupChatId({ secured_general_chat_id: '-34' }), '-34')
  assert.equal(selectTelegramGroupChatId({}), undefined)
  assert.equal(selectTelegramGroupChatId(null), undefined)
  assert.equal(selectTelegramGroupChatId(undefined, '-56'), '-56', 'existing DTO fallback is preserved')
})
