import assert from 'node:assert/strict'
import { test } from 'node:test'
import { usernameDisplay, updateUsernameInput, usernamePayload } from './username-input.js'

test('Username keeps one leading @ and allows Latin letters, digits and underscores', () => {
  assert.equal(usernameDisplay(''), '@')
  assert.equal(usernameDisplay('Alice'), '@Alice')
  assert.equal(usernameDisplay('@@Alice'), '@Alice')
  for (const [input, expected] of [
    ['Alice', '@Alice'], ['@Alice', '@Alice'], ['@@Al@ice', '@Alice'],
    ['@alice_123', '@alice_123'], ['Alice123', '@Alice123'], ['Alice_name', '@Alice_name'],
    ['@AliceЯ 12_🙂é', '@Alice12_'], ['Кира', '@'], ['', '@'], ['@', '@']
  ]) {
    const target = { value: input, selectionStart: input.length, setSelectionRange() {} }
    assert.equal(updateUsernameInput({ target }), expected)
    assert.equal(target.value, expected)
  }
})

test('Username editing preserves digits, underscores and the caret in the middle', () => {
  let selection
  const target = {
    value: '@Al_1!ice23', selectionStart: 6,
    setSelectionRange(start, end) { selection = [start, end] }
  }
  assert.equal(updateUsernameInput({ target }), '@Al_1ice23')
  assert.deepEqual(selection, [5, 5])
})

test('Username payload preserves the existing field contract and rejects invalid legacy values', () => {
  assert.equal(usernamePayload('Alice'), '@Alice')
  assert.equal(usernamePayload('@@Alice'), '@Alice')
  assert.equal(usernamePayload('alice_123'), '@alice_123')
  assert.equal(usernamePayload('@Alice_123'), '@Alice_123')
  assert.equal(usernamePayload('@'), '')
  assert.equal(usernamePayload(''), '')
  for (const value of ['Кира', '@alice-123', '@alice.123', '@Alice Smith', '@élise']) {
    assert.throws(() => usernamePayload(value), /Username/)
  }
})
