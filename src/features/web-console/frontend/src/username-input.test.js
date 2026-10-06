import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usernameDisplay, updateUsernameInput, usernamePayload } from './username-input.js'

test('Username keeps one leading @ and filters typing, paste and deletion to Latin letters', () => {
  assert.equal(usernameDisplay(''), '@')
  assert.equal(usernameDisplay('Alice'), '@Alice')
  assert.equal(usernameDisplay('@@Alice'), '@Alice')
  for (const [input, expected] of [
    ['Alice', '@Alice'], ['@Alice', '@Alice'], ['@@Al@ice', '@Alice'],
    ['@AliceЯ 12_🙂é', '@Alice'], ['Кира', '@'], ['', '@'], ['@', '@']
  ]) {
    const target = { value: input, selectionStart: input.length, setSelectionRange() {} }
    assert.equal(updateUsernameInput({ target }), expected)
    assert.equal(target.value, expected)
  }
})

test('Username payload preserves the existing field contract and rejects invalid legacy values', () => {
  assert.equal(usernamePayload('Alice'), '@Alice')
  assert.equal(usernamePayload('@@Alice'), '@Alice')
  assert.equal(usernamePayload('@'), '')
  assert.equal(usernamePayload(''), '')
  for (const value of ['Кира', '@alice_123', '@Alice Smith', '@élise']) {
    assert.throws(() => usernamePayload(value), /Username/)
  }
})
