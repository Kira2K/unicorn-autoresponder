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
  const calls: Array<{ title: string; locationId: string; cursor?: string }> = []
  let clock = new Date('2026-08-29T09:00:00Z').getTime()
  const adapter = {
    async resolveLocations() { return { data: [{ id: 'geo-berlin', name: 'Berlin' }] } },
    async searchPeople(_accountId: string, input: { title: string; locationId: string }, cursor?: string) {
      calls.push({ ...input, cursor })
      const page = calls.length
      return {
        items: page === 15 ? [{ id: 'person-15', display_name: 'Berlin Recruiter',
          headline: 'Technical Recruiter', location: 'Berlin', network_distance: 2 }] : [],
        next_cursor: `cursor-${page}`
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
  const discovery = await createCandidateDiscovery(runtime, run, async () => undefined)
  const candidates = await discovery.next('recruiter')

  assert.equal(calls.length, 15)
  assert.equal(new Set(calls.map(call => call.title)).size, 1)
  assert.deepEqual(new Set(calls.map(call => call.locationId)), new Set(['geo-berlin']))
  assert.equal(calls[0].cursor, undefined)
  assert.equal(calls[14].cursor, 'cursor-14')
  assert.match(calls[0].title, /"Technical Recruiter"/)
  assert.equal(calls[0].title.includes('Berlin'), false)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].personId, 'person-15')
  assert.equal(run.searchProgress.streams.recruiter.sourceKey, 'recruiter-berlin')
  assert.equal(run.searchProgress.streams.recruiter.page, 15)
  assert.equal(run.searchProgress.streams.recruiter.nextCursor, 'cursor-15')
  assert.equal(run.searchProgress.streams.recruiter.locationId, 'geo-berlin')
  assert.equal(run.searchProgress.locations.Berlin.id, 'geo-berlin')
  assert.equal(run.searchProgress.keyIndex.recruiter, 0)
}

run().then(() => console.log('connection city cursor flow tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
