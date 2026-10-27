const { test } = require('node:test')
const assert = require('node:assert/strict')
const { intakeScenario, infrastructureReady, infrastructureSignature } = require('./linkedin-intake.js')
const { registrationTimeInput, registrationTimeUtc } = require('./linkedin-intake.js')
test('registration date converts between local input and UTC without shifting the entered local time', () => {
  const local = '2026-10-25T10:30'
  const utc = registrationTimeUtc(local)
  assert.equal(utc, new Date(2026, 9, 25, 10, 30).toISOString())
  assert.equal(registrationTimeInput(utc), local)
  assert.equal(registrationTimeUtc(''), undefined)
  assert.equal(registrationTimeInput(undefined), '')
  for (const value of ['bad', '2026-02-30T10:30']) assert.throws(() => registrationTimeUtc(value))
})
test('only nonblank LinkedIn URL selects existing scenario', () => {
  assert.equal(intakeScenario({ login: 'alex', url: ' ' }), '')
  assert.equal(intakeScenario({ url: 'https://linkedin.com/in/alex' }), 'existing')
})
test('checkpoint infrastructure depends on EN proxy, complete locales and proxy changes, not grant expiry', () => {
  const status = { requiredLocales: ['ru','en'], profiles: [{ id: 1, locale: 'ru', phase: 'ready' },
    { id: 2, locale: 'en', phase: 'ready', proxy: { configured: true, host: 'proxy.example.com', port: 80 } }] }
  assert.equal(infrastructureReady(status), true)
  const signature = infrastructureSignature(status)
  status.profiles[1].phase = 'granted'
  assert.equal(infrastructureSignature(status), signature)
  status.profiles[1].proxy.phase = 'attaching'
  assert.equal(infrastructureReady(status), false)
  assert.notEqual(infrastructureSignature(status), signature)
})
