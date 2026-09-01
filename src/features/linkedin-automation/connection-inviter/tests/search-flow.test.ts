const assert = require('node:assert/strict')
const { createCandidateDiscovery } = require('../discovery.ts') as typeof import('../discovery.ts')
const { createMemoryConnectionInviterStore } = require('../memory-store.ts') as
  typeof import('../memory-store.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')

async function run() {
  const store = createMemoryConnectionInviterStore()
  store.listCatalog = async () => [{
    sourceKey: 'recruiter-berlin', audience: 'recruiter', city: 'Berlin',
    keywordTemplate: 'legacy-value-is-ignored', priority: 1, enabled: true
  }]
  const run = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test',
    linkedinUrl: 'https://linkedin.com/in/test', accountId: 'acc_test', stack: 'GO' },
  new Date('2026-08-29T09:00:00Z'), 'Europe/Moscow', false)
  const calls: Array<{ keywords: string; locationId: string; cursor?: string; at: number }> = []
  let clock = new Date('2026-08-29T09:00:00Z').getTime()
  let locationAt = 0
  const adapter = {
    async resolveLocations() {
      locationAt = clock
      return { data: [{ id: 'geo-berlin', name: 'Berlin' }] }
    },
    async searchPeople(_accountId: string, input: { keywords: string; locationId: string }, cursor?: string) {
      calls.push({ ...input, cursor, at: clock })
      return {
        items: calls.length === 1 ? [{ id: 'person-1', display_name: 'Berlin Recruiter',
          headline: 'Technical Recruiter', location: 'Berlin', network_distance: 2 }] : [],
        next_cursor: `cursor-${calls.length}`
      }
    }
  }
  const runtime: any = {
    store, repository: {}, adapter: () => adapter, now: () => new Date(clock),
    timeZone: 'Europe/Moscow', random: () => 0,
    sleep: async (milliseconds: number) => { clock += milliseconds },
    stopRequested: () => false, emit() {}, logger: { event() {} },
    writerEnabled: true, writerId: 'test'
  }
  await store.createRun(run)
  const saves: Array<{ event: string; mode: string | undefined }> = []
  let delayedCheckpoint = false
  const save: any = async (value: any, event: string, mode?: string) => {
    saves.push({ event, mode })
    if (!delayedCheckpoint && event === 'progress' && mode === 'critical') {
      delayedCheckpoint = true
      clock += 120_000
    }
    await store.updateRun(value)
  }
  const discovery = await createCandidateDiscovery(runtime, run, save)
  const candidates = await discovery.next('recruiter')

  assert.equal(calls.length, 1)
  assert.equal(new Set(calls.map(call => call.keywords)).size, 1)
  assert.deepEqual(new Set(calls.map(call => call.locationId)), new Set(['geo-berlin']))
  assert.equal(calls[0].cursor, undefined)
  assert.equal(calls[0].keywords, 'Recruiter')
  assert.equal(calls[0].keywords.includes('Berlin'), false)
  assert.equal(calls[0].at - locationAt >= 60_000, true)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].personId, 'person-1')
  assert.equal(run.searchProgress.streams.recruiter.sourceKey, 'recruiter-berlin')
  assert.equal(run.searchProgress.streams.recruiter.page, 1)
  assert.equal(run.searchProgress.streams.recruiter.nextCursor, 'cursor-1')
  assert.equal(run.searchProgress.streams.recruiter.term, 'Recruiter')
  assert.equal(run.searchProgress.streams.recruiter.locationId, 'geo-berlin')
  assert.equal(run.searchProgress.locations.Berlin.id, 'geo-berlin')
  assert.equal(run.searchProgress.keyIndex.recruiter, 0)
  assert.deepEqual(run.searchProgress.passUsedSearchKeys, ['recruiter-berlin'])
  assert.equal(saves.filter(item => item.event === 'progress' && item.mode === 'critical').length >= 3,
    true)

  const resumedCalls: Array<{ keywords: string; cursor?: string; at: number }> = []
  store.listCatalog = async () => [{
    sourceKey: 'recruiter-berlin', audience: 'recruiter', city: 'Berlin',
    keywordTemplate: 'legacy-value-is-ignored', priority: 1, enabled: true
  }, {
    sourceKey: 'recruiter-paris', audience: 'recruiter', city: 'Paris',
    keywordTemplate: 'legacy-value-is-ignored', priority: 2, enabled: true
  }] as any
  adapter.searchPeople = async (_accountId: string, input: any, cursor?: string) => {
    resumedCalls.push({ keywords: input.keywords, cursor, at: clock })
    return { items: [{ id: 'person-2', display_name: 'Second Recruiter',
      headline: 'Recruiter', location: 'Berlin', network_distance: 2 }], next_cursor: 'cursor-2' }
  }
  const reloaded = (await store.getRun(run.runId))!
  reloaded.searchProgress.pendingCandidates = []
  reloaded.searchProgress.consecutiveEmptyRecruiterSearches = 7
  const resumedDiscovery = await createCandidateDiscovery(runtime, reloaded, save)
  await resumedDiscovery.next('recruiter')
  assert.equal(resumedCalls[0].keywords, 'Recruiter')
  assert.equal(resumedCalls[0].cursor, 'cursor-1')
  assert.equal(reloaded.searchProgress.streams.recruiter.sourceKey, 'recruiter-berlin')
  assert.equal(resumedCalls[0].at - calls[0].at >= 60_000, true)
  assert.equal(reloaded.searchProgress.consecutiveEmptyRecruiterSearches, 7)

  const emptyCursorCalls: string[] = []
  adapter.searchPeople = async (_accountId: string, input: any, cursor?: string) => {
    emptyCursorCalls.push(`${input.keywords}:${cursor ?? 'first'}`)
    return { items: [], next_cursor: `empty-${emptyCursorCalls.length}` }
  }
  run.searchProgress.streams.recruiter.nextCursor = undefined
  run.searchProgress.streams.recruiter.page = 0
  run.searchProgress.streams.recruiter.emptyCursorStreak = 0
  run.searchProgress.pendingCandidates = []
  const emptyDiscovery = await createCandidateDiscovery(runtime, run, save)
  await emptyDiscovery.next('recruiter')
  assert.equal(emptyCursorCalls.slice(0, 2).every(item => item.startsWith('Recruiter:')), true)
  assert.equal(emptyCursorCalls[2].startsWith('Talent Acquisition:'), true)
}

run().then(() => console.log('connection city cursor flow tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
