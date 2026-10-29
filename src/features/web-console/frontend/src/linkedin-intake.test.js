const { test } = require('node:test')
const assert = require('node:assert/strict')
const { intakeScenario, infrastructureReady, infrastructureSignature } = require('./linkedin-intake.js')
const { registrationTimeInput, registrationTimeUtc } = require('./linkedin-intake.js')
const { linkedInCreationPending } = require('./linkedin-intake.js')

test('creation label follows the current application, not draft credentials or another account/student', () => {
  const account = { id: 19, url: 'https://linkedin.com/in/draft', login: 'draft@outlook.com' }
  for (const status of ['не начата', 'блок', 'сделана экспертом', 'выполнение подтверждено']) {
    const state = { clientId: 7, linkedinAccountId: 19, registrationPending: status !== 'выполнение подтверждено' }
    assert.equal(linkedInCreationPending(account, state, 7), status !== 'выполнение подтверждено')
    assert.equal(linkedInCreationPending({ id: 18 }, state, 7), false)
    assert.equal(linkedInCreationPending(account, state, 8), false)
  }
  assert.equal(linkedInCreationPending(account, {}, 7), false, 'existing accounts without an application stay active')
  assert.equal(linkedInCreationPending(account, { clientId: 7, registrationPending: true }, 7), false)
})
test('registration date converts between local input and UTC without shifting the entered local time', () => {
  const local = '2026-10-25T10:30'
  const utc = registrationTimeUtc(local)
  assert.equal(utc, new Date(2026, 9, 25, 10, 30).toISOString())
  assert.equal(registrationTimeInput(utc), local)
  assert.equal(registrationTimeUtc(''), undefined)
  assert.equal(registrationTimeInput(undefined), '')
  for (const value of ['bad', '2026-02-30T10:30']) assert.throws(() => registrationTimeUtc(value))
})
test('registered-account metadata or a nonblank URL selects existing; an unclassified login alone does not', () => {
  assert.equal(intakeScenario({ login: 'alex', url: ' ' }), '')
  assert.equal(intakeScenario({ url: 'https://linkedin.com/in/alex' }), 'existing')
  assert.equal(intakeScenario({ hasLinkedIn: true, login: 'https://linkedin.com/in/legacy', url: '' }), 'existing')
  assert.equal(intakeScenario({ hasLinkedIn: false, url: '' }), '')
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
