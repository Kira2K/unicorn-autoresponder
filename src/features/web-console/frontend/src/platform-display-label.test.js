import assert from 'node:assert/strict'
import { test } from 'node:test'
import { platformDisplayLabel } from './platform-display-label.js'

test('market labels are presentation only and custom account names remain unchanged', () => {
  for (const [code, name] of [['email', 'Email'], ['phone', 'Телефон'], ['telegram', 'Telegram'], ['hh', 'HH']]) {
    assert.equal(platformDisplayLabel(code + '_ru'), name + ' для ру рынка')
    assert.equal(platformDisplayLabel(code + '_en'), name + ' для зарубежного рынка')
  }
  assert.equal(platformDisplayLabel('linkedin'), 'LinkedIn')
  assert.equal(platformDisplayLabel('github'), 'GitHub')
  assert.equal(platformDisplayLabel('Мой рабочий аккаунт'), 'Мой рабочий аккаунт')
  assert.equal(platformDisplayLabel('unknown_platform'), 'unknown_platform')
  assert.equal(platformDisplayLabel(null), '')
})
