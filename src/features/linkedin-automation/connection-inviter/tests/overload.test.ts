const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

const busy = (status: number) => Object.assign(new Error(`busy ${status}`), {
  code: `unipile_http_${status}`, details: { httpStatus: status }
})

async function searchRetriesSameCursor() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const original = test.adapter.searchPeople
  const failures = [busy(429), busy(503), busy(429)]
  const failedCursors: Array<string | undefined> = []
  test.adapter.searchPeople = async (accountId: string, keywords: string, cursor?: string) => {
    if (!cursor) {
      const response = await original(accountId, keywords)
      return { ...response, items: response.items.slice(0, 1), next_cursor: 'same-cursor' }
    }
    if (failures.length) { failedCursors.push(cursor); throw failures.shift() }
    return original(accountId, keywords)
  }
  const retryDelays: number[] = []
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined, logger: { event(stage: string, status: string, details?: any) {
      if (stage === 'retry' && status === 'failed') retryDelays.push(details.delayMs)
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded')
  assert.deepEqual(failedCursors, ['same-cursor', 'same-cursor', 'same-cursor'])
  assert.deepEqual(retryDelays.slice(0, 3), [90_000, 180_000, 270_000])
}

async function invitation429ReadbackThenRetry() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const original = test.adapter.sendInvitation; let posts = 0
  test.adapter.sendInvitation = async (accountId: string, personId: string) => {
    posts += 1
    if (posts === 1) throw busy(429)
    return original(accountId, personId)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(posts, 6); assert.equal(test.metrics.sends, 5)
}

async function nocoRetriesWithoutStoppingRun() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const updateRun = test.store.updateRun.bind(test.store); let failures = 3
  test.store.updateRun = async (run: any) => {
    if (failures > 0) {
      failures -= 1
      throw Object.assign(new Error('Noco busy'), { code: 'noco_rate_limited',
        details: { httpStatus: 429 } })
    }
    return updateRun(run)
  }
  const retryDelays: number[] = []
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined, logger: { event(stage: string, status: string, details?: any) {
      if (stage === 'retry' && status === 'failed' && details?.provider === 'noco') {
        retryDelays.push(details.delayMs)
      }
    } } })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.deepEqual(retryDelays, [90_000, 180_000, 270_000])
}

async function nocoFailurePreservesUnipileRetry() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  const search = test.adapter.searchPeople; let searchFailed = false
  test.adapter.searchPeople = async (accountId: string, keywords: string) => {
    if (!searchFailed) { searchFailed = true; throw busy(429) }
    return search(accountId, keywords)
  }
  const updateRun = test.store.updateRun.bind(test.store); let nocoFailed = false
  test.store.updateRun = async (run: any) => {
    if (!nocoFailed && run.retryState?.provider === 'unipile') {
      nocoFailed = true
      throw Object.assign(new Error('Noco busy'), { code: 'noco_rate_limited',
        details: { httpStatus: 429 } })
    }
    return updateRun(run)
  }
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const completed: any = await waitRun(service, started.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 5)
  assert.equal(searchFailed, true); assert.equal(nocoFailed, true)
}

Promise.all([searchRetriesSameCursor(), invitation429ReadbackThenRetry(),
  nocoRetriesWithoutStoppingRun(), nocoFailurePreservesUnipileRetry()])
  .then(() => console.log('connection overload tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
