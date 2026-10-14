import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserWelcomeKey, dismissBrowserWelcome, shouldShowBrowserWelcome, missingOctoLocales, octoOnboardingBusy, canContinueOctoOnboarding, octoLocationComplete, createOctoLocationPicker } from './octo-onboarding.js'

test('Welcome dismissal is scoped by notice version and client, including unavailable storage', () => {
  const data = new Map()
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  assert.equal(shouldShowBrowserWelcome(storage, null), false)
  assert.equal(shouldShowBrowserWelcome(storage, 1), true)
  dismissBrowserWelcome(storage, 1)
  assert.equal(shouldShowBrowserWelcome(storage, 1), false)
  assert.equal(shouldShowBrowserWelcome(storage, 2), true)
  assert.equal(browserWelcomeKey(1), 'webConsole.octoWelcome.v1.1')
  const blockedStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(shouldShowBrowserWelcome(blockedStorage, 1), true)
  assert.doesNotThrow(() => dismissBrowserWelcome(blockedStorage, 1))
})

test('API required locales determine setup; only healthy low-score own/import checks may continue', () => {
  assert.deepEqual(missingOctoLocales({ requiredLocales: ['Ru', 'En'], profiles: [{ locale: 'Ru' }] }), ['En'])
  assert.deepEqual(missingOctoLocales({ requiredLocales: ['Ru'], profiles: [] }), ['Ru'])
  for (const phase of ['queued', 'checking', 'provisioning']) assert.equal(octoOnboardingBusy({ onboarding: { phase } }), true)
  assert.equal(octoOnboardingBusy({ onboarding: { phase: 'awaiting_confirmation' } }), false)
  const candidate = { id: 'setup-1', source: 'own', phase: 'awaiting_confirmation', score: 50 }
  assert.equal(canContinueOctoOnboarding(candidate), true)
  assert.equal(canContinueOctoOnboarding({ ...candidate, source: 'dolphin' }), true)
  for (const fields of [{ score: null }, { score: -1 }, { score: 70 }, { source: 'nodemaven' }, { error: 'proxy_unreachable' }, { phase: 'blocked' }, { id: undefined }]) {
    assert.equal(canContinueOctoOnboarding({ ...candidate, ...fields }), false)
  }
})

test('Location picker requires available regions and cities, clearing descendants on changes', async () => {
  let state
  const calls = []
  const items = { countries: [{ code: 'US', name: 'United States' }], regions: [{ code: 'CA', name: 'California' }], cities: [{ code: 'SF', name: 'San Francisco' }] }
  const picker = createOctoLocationPicker(async (level, location) => { calls.push({ level, location }); return { items: items[level] } }, snapshot => { state = snapshot })
  await picker.countries()
  await picker.country('US')
  assert.equal(octoLocationComplete(state.location, state.lists), false)
  assert.equal(calls.some(call => call.level === 'cities'), false)
  await picker.region('CA')
  assert.equal(octoLocationComplete(state.location, state.lists), false)
  picker.city('SF')
  assert.equal(octoLocationComplete(state.location, state.lists), true)
  assert.deepEqual(calls.at(-1), { level: 'cities', location: { country: 'US', region: 'CA', city: '' } })
  await picker.country('US')
  assert.equal(state.location.region, '')
  assert.equal(state.location.city, '')
  assert.equal(state.lists.cities.loaded, false)
  assert.equal(octoLocationComplete(state.location, state.lists), false)
})

test('Empty regions query country cities; empty cities may be skipped but errors block until retry', async () => {
  let state, failCities = true
  const calls = []
  const picker = createOctoLocationPicker(async (level, location) => {
    calls.push({ level, location })
    if (level === 'cities' && failCities) throw new Error('offline')
    return { items: level === 'countries' ? [{ code: 'US', name: 'United States' }] : [] }
  }, snapshot => { state = snapshot })
  await picker.countries()
  await picker.country('US')
  assert.deepEqual(calls.at(-1), { level: 'cities', location: { country: 'US', region: '', city: '' } })
  assert.equal(octoLocationComplete(state.location, state.lists), false)
  assert.ok(state.lists.cities.error)
  failCities = false
  await picker.retryCities()
  assert.equal(octoLocationComplete(state.location, state.lists), true)
})

test('Out-of-order location results and cancelled wizard work cannot replace the current selection', async () => {
  let state, releaseOld
  const picker = createOctoLocationPicker(async (level, location) => {
    if (level === 'countries') return { items: [{ code: 'US' }, { code: 'GB' }] }
    if (location.country === 'US') return new Promise(resolve => { releaseOld = resolve })
    return { items: level === 'regions' ? [{ code: 'London' }] : [] }
  }, snapshot => { state = snapshot })
  await picker.countries()
  const old = picker.country('US')
  await picker.country('GB')
  releaseOld({ items: [{ code: 'stale' }] })
  await old
  assert.equal(state.location.country, 'GB')
  assert.equal(state.lists.regions.items[0].code, 'London')
  const cancelled = picker.country('US')
  picker.cancel()
  const snapshot = structuredClone(state)
  releaseOld({ items: [{ code: 'stale' }] })
  await cancelled
  assert.deepEqual(state, snapshot)
})
