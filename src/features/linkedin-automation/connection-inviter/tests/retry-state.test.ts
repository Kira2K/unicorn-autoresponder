const assert = require('node:assert/strict')
const { connectionRetryDelay, retryAfterMilliseconds,
  makeRetryState, unipileRateLimitDelay, withConnectionRetry } = require('../retry-state.ts') as
  typeof import('../retry-state.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { waitOrStop } = require('../run-control.ts') as typeof import('../run-control.ts')
const { fixture } = require('./fixtures.ts') as typeof import('./fixtures.ts')

assert.equal(connectionRetryDelay(1, () => 0), 90_000)
assert.equal(connectionRetryDelay(1, () => 1), 180_000)
assert.equal(connectionRetryDelay(2, () => 0), 180_000)
assert.equal(connectionRetryDelay(2, () => 1), 270_000)
assert.equal(connectionRetryDelay(20, () => 0), 1_710_000)
assert.equal(connectionRetryDelay(20, () => 1), 1_800_000)
assert.equal(connectionRetryDelay(50, () => .5), 1_755_000)
assert.equal(connectionRetryDelay(1, () => 0, 3_600_000), 3_600_000)
assert.equal(retryAfterMilliseconds({ details: { retryAfter: 120 } }), 120_000)
assert.equal(retryAfterMilliseconds({ details: { retryAfterMs: 3_600_000 } }), 3_600_000)
assert.equal(unipileRateLimitDelay(1, () => 0), 180_000)
assert.equal(unipileRateLimitDelay(1, () => 1), 240_000)
assert.equal(unipileRateLimitDelay(2, () => 0), 360_000)
assert.equal(unipileRateLimitDelay(3, () => 0), 720_000)
assert.equal(unipileRateLimitDelay(4, () => 0), 1_440_000)
assert.equal(unipileRateLimitDelay(5, () => 0), 1_800_000)
assert.equal(unipileRateLimitDelay(1, () => 0, 3_600_000), 3_600_000)

async function run() {
  const test = fixture({ stack: 'GO' })
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://linkedin.com/in/test', accountId: 'acc_test', stack: 'GO' },
  new Date('2026-08-29T09:00:00Z'), 'Europe/Moscow', false)
  await test.store.createRun(run)
  const attempts: number[] = []; let calls = 0; let now = 0
  const runtime: any = { ...test, adapter: () => test.adapter, timeZone: 'Europe/Moscow',
    now: () => new Date(1_700_000_000_000 + now), random: () => 0,
    sleep: async (milliseconds: number) => { now += milliseconds },
    stopRequested: () => false, emit() {} }
  const save = async () => undefined
  const rateLimitError = Object.assign(new Error('busy'), {
    code: 'unipile_api_too_many_requests',
    details: { httpStatus: 429, retryAfter: 120 }
  })
  const firstRateLimit = makeRetryState(runtime, run, 'unipile', 'people_search', rateLimitError)
  assert.equal(firstRateLimit.delayMs, 180_000)
  run.retryState = firstRateLimit
  const secondRateLimit = makeRetryState(runtime, run, 'unipile', 'people_search', rateLimitError)
  assert.equal(secondRateLimit.delayMs, 360_000)
  run.retryState = undefined
  const result = await withConnectionRetry(runtime, run, save, 'unipile', 'people_search', async () => {
    calls += 1
    if (calls < 3) throw Object.assign(new Error('busy'),
      { code: 'unipile_http_429', details: { httpStatus: 429 } })
    return 'ok'
  })
  assert.equal(result, 'ok'); assert.equal(calls, 3); assert.equal(now, 540_000)
  assert.equal(run.retryState, undefined); assert.equal(run.stage, 'queued')

  let stop = false; let waitCalls = 0
  const stopped = await waitOrStop({ stopRequested: () => stop,
    sleep: async () => { waitCalls += 1; stop = true } } as any, run.runId, 30 * 60_000)
  assert.equal(stopped, false); assert.equal(waitCalls, 1)
}

run().then(() => console.log('connection retry state tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
