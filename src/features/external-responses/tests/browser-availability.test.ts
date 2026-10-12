import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openApplicationBrowser } from '../application_workflow/browser-availability.ts'
import { createDolphinBrowser } from '../infrastructure/dolphin-browser.ts'
import { createRequire } from 'node:module'
const { AUTOMATION_LOCK_TAG, AUTOMATION_LOCK_STATUS_NAME } = createRequire(import.meta.url)('../../hh-responses/orchestrator/config.ts')
const input = { profileId: 1, owner: 'test', event: async () => {} }

test('busy student is deferred and the next student can acquire a browser', async () => {
  const outcomes = []
  for (const profileId of [1, 2]) outcomes.push(await openApplicationBrowser({ ...input, profileId }, async i => {
    if (i.profileId === 1) throw Error('dolphin_profile_busy')
    return {} as any
  }))
  assert.deepEqual(outcomes.map(o => o.status), ['busy', 'available'])
})
test('foreign ownership is busy; real acquisition errors remain errors', async () => {
  for (const message of ['dolphin_profile_owned:1:pid=2', 'dolphin_profile_already_owned:1']) {
    assert.equal((await openApplicationBrowser(input, async () => { throw Error(message) })).status, 'busy')
  }
  for (const message of ['network_failure', 'dolphin_proxy_missing', 'some busy text']) {
    await assert.rejects(openApplicationBrowser(input, async () => { throw Error(message) }), { message })
  }
})
test('busy cloud status/tag takes precedence over proxy checks, never loads driver or starts/stops', async () => {
  for (const profile of [{ tags: [AUTOMATION_LOCK_TAG] }, { status: { name: AUTOMATION_LOCK_STATUS_NAME } }]) {
    const calls: string[] = []
    const deps: any = { ready: async () => {}, profile: async () => profile, driver: () => calls.push('driver'), start: async () => calls.push('start'), stop: async () => calls.push('stop') }
    const outcome = await openApplicationBrowser(input, i => createDolphinBrowser(i, deps))
    assert.equal(outcome.status, 'busy'); assert.deepEqual(calls, [])
  }
})
test('racing server busy never stops or attaches to the profile', async () => {
  const calls: string[] = []
  const deps: any = { ready: async () => {}, profile: async () => ({ proxy: { host: 'x' } }), driver: () => ({}), start: async () => { throw Object.assign(Error('server duplicate'), { details: { errorObject: { code: 'E_BROWSER_RUN_DUPLICATE' } } }) }, stop: async () => calls.push('stop') }
  assert.equal((await openApplicationBrowser(input, i => createDolphinBrowser(i, deps))).status, 'busy')
  assert.deepEqual(calls, [])
})
