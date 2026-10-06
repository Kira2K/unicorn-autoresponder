import assert from 'node:assert/strict'
import { test } from 'node:test'
import { telegramInputValue, phoneInputValue, updateContactInput } from './contact-input.js'

test('personal Telegram always has one @ without removing valid username digits or underscores', () => {
  for (const [input, expected] of [['', '@'], ['@', '@'], ['kira_123', '@kira_123'], [' @kira_123 ', '@kira_123'], ['@@kira_123', '@kira_123']]) {
    assert.equal(telegramInputValue(input), expected)
  }
})

test('phone fields always show + followed only by contiguous ASCII digits', () => {
  for (const platform of ['phone_en', 'phone_ru']) {
    for (const [input, expected] of [['', '+'], ['+', '+'], ['abcЯ🙂', '+'], ['++7 (999) 123-45-67', '+79991234567'], ['+7А9 abc', '+79']]) {
      assert.equal(phoneInputValue(input, platform), expected)
    }
  }
  assert.equal(phoneInputValue('8 (999) 123-45-67', 'phone_ru'), '+79991234567')
  assert.equal(phoneInputValue('8 (999) 123-45-67', 'phone_en'), '+89991234567')
})

test('native field and caret normalize even when deleting prefixes or rejecting repeated characters', () => {
  for (const format of [telegramInputValue, value => phoneInputValue(value, 'phone_ru')]) {
    let selection
    const target = { value: '', selectionStart: 0, setSelectionRange: (...args) => { selection = args } }
    assert.equal(updateContactInput({ target }, format), format(''))
    assert.equal(target.value, format(''))
    assert.deepEqual(selection, [1, 1])
  }
  const target = { value: '+79Я99', selectionStart: 4, setSelectionRange: (start, end) => assert.deepEqual([start, end], [3, 3]) }
  assert.equal(updateContactInput({ target }, value => phoneInputValue(value, 'phone_ru')), '+7999')
})
