import assert from 'node:assert/strict'
import { test } from 'node:test'
import { telegramInputValue, phoneInputValue, phonePayload, isAccountPhoneField, updateContactInput } from './contact-input.js'

test('personal Telegram always has one @ without removing valid username digits or underscores', () => {
  for (const [input, expected] of [['', '@'], ['@', '@'], ['kira_123', '@kira_123'], [' @kira_123 ', '@kira_123'], ['@@kira_123', '@kira_123']]) {
    assert.equal(telegramInputValue(input), expected)
  }
})

test('phone fields always show + followed only by contiguous ASCII digits', () => {
  for (const platform of ['phone_en', 'phone_ru', 'hh_en', 'hh_ru', 'telegram_en', 'telegram_ru']) {
    for (const [input, expected] of [['', '+'], ['+', '+'], ['abcЯ🙂', '+'], ['++7 (999) 123-45-67', '+79991234567'], ['+7А9 abc', '+79']]) {
      assert.equal(phoneInputValue(input, platform), expected)
    }
  }
  assert.equal(phoneInputValue('8 (999) 123-45-67', 'phone_ru'), '+89991234567')
  assert.equal(phoneInputValue('8 (999) 123-45-67', 'phone_en'), '+89991234567')
})

test('HH phone fields preserve international country codes during input and submission', () => {
  for (const platform of ['phone_ru', 'hh_ru', 'hh_en']) {
    for (const [input, expected] of [
      ['+1 (555) 123-4567', '+15551234567'], ['+44 7700 900123', '+447700900123'],
      ['+375 (29) 123-45-67', '+375291234567'], ['+995 555 123456', '+995555123456'],
      ['+856 20 123 456', '+85620123456'], ['+800 1234 5678', '+80012345678'],
      ['856 20 123 456', '+85620123456'], ['800 1234 5678', '+80012345678']
    ]) {
      assert.equal(phoneInputValue(input, platform), expected, `${platform}: ${input}`)
      assert.equal(phonePayload(input, platform), expected, `${platform}: ${input}`)
      assert.equal(phoneInputValue(phoneInputValue(input, platform), platform), expected)
    }
  }
})

test('account phone fields include Telegram login but preserve email logins', () => {
  for (const platform of ['phone_en', 'phone_ru', 'hh_en', 'hh_ru', 'telegram_en', 'telegram_ru', 'linkedin']) {
    assert.equal(isAccountPhoneField('phone', platform), true)
    assert.equal(isAccountPhoneField('foreignNumber', platform), true)
    assert.equal(isAccountPhoneField('login', platform), platform.startsWith('telegram_'))
    assert.equal(isAccountPhoneField('password', platform), false)
  }
})

test('phone payload normalizes saved legacy values and treats a lone plus as empty', () => {
  for (const input of ['', '+', 'abc']) assert.equal(phonePayload(input, 'hh_en'), '')
  assert.equal(phonePayload('+44 (123) 45-67', 'hh_en'), '+441234567')
  assert.equal(phonePayload('++7 999-123-45-67', 'telegram_ru'), '+79991234567')
  assert.equal(phonePayload('8 (999) 123-45-67', 'phone_ru'), '+89991234567')
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
