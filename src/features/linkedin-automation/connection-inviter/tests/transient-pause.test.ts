const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { transientConnectionError } = require('../errors.ts') as typeof import('../errors.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function run() {
  assert.equal(transientConnectionError({ code: 'noco_rate_limited' }), true)
  assert.equal(transientConnectionError({ code: 'unipile_http_429',
    details: { httpStatus: 429 } }), true)
  assert.equal(transientConnectionError({ code: 'connection_account_mismatch' }), false)

  const test = fixture({ stack: 'Frontend' })
  const search = test.adapter.searchPeople; let first = true
  test.adapter.searchPeople = async (accountId: string, keywords: string) => {
    if (first) {
      first = false
      throw Object.assign(new Error('busy'),
        { code: 'unipile_http_429', details: { httpStatus: 429 } })
    }
    return search(accountId, keywords)
  }
  const events: Array<{ stage: string; status: string; details?: any }> = []
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0, sleep: async () => undefined,
    logger: { event(stage: string, status: string, details?: any) {
      events.push({ stage, status, details })
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 11)
  const retry = events.find(event => event.stage === 'retry' && event.status === 'failed')
  assert.equal(retry?.details?.attempt, 1)
  assert.equal(retry?.details?.delayMs, 180_000)
}

run().then(() => console.log('connection transient pause tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
