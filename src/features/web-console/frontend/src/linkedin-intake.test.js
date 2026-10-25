const { test } = require('node:test')
const assert = require('node:assert/strict')
const { intakeScenario, infrastructureReady, infrastructureSignature } = require('./linkedin-intake.js')
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
