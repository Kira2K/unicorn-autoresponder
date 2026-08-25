const assert = require('node:assert/strict')
const { DAY_MS, SESSION_MS, nextCheckAt, nextCheckDelay, replyDelay } =
  require('../schedule.ts') as typeof import('../schedule.ts')

assert.equal(nextCheckDelay(0, () => 0), 25 * 60_000)
assert.equal(nextCheckDelay(0, () => 1), 35 * 60_000)
assert.equal(nextCheckDelay(DAY_MS, () => 0), 120 * 60_000)
assert.equal(nextCheckDelay(DAY_MS, () => 1), 150 * 60_000)
assert.equal(replyDelay(() => 0), 45_000)
assert.equal(replyDelay(() => 1), 120_000)
const started = '2026-01-01T00:00:00.000Z'
assert.equal(nextCheckAt(started, Date.parse(started) + SESSION_MS), undefined)
console.log('comment monitor schedule tests passed')
