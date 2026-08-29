const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function run() {
  const test = fixture({ stack: 'GO', connectionCount: 149 })
  test.store.listCatalog = async () => [
    { sourceKey: 'recruiter-berlin-test', audience: 'recruiter', city: 'Berlin',
      keywordTemplate: 'Recruiter', priority: 1, enabled: true },
    { sourceKey: 'technical-berlin-test', audience: 'technical', city: 'Berlin',
      keywordTemplate: '{stack} Engineer', priority: 2, enabled: true }
  ]
  test.adapter.searchPeople = async () => ({ items: [{ id: 'wrong-city',
    display_name: 'Wrong City', headline: 'Account Executive',
    location: 'London', network_distance: 2 }] })
  const service = createConnectionInviterService({ ...test,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const started: any = await service.start(7)
  const partial: any = await waitRun(service, started.runId)
  assert.equal(partial.status, 'partial'); assert.equal(partial.stage, 'search_exhausted')
  assert.equal(partial.counters.sent, 0); assert.equal(test.metrics.sends, 0)
  assert.equal(partial.searchProgress.exhausted.recruiter, true)
  assert.equal(partial.searchProgress.exhausted.technical, true)
  assert.equal(partial.skipReasonCounters['hard:role_mismatch'] > 0, true)
  assert.equal(partial.skipReasonCounters['soft:city_outside_target'] > 0, true)
  assert.deepEqual(await service.history(7), [])
  const second: any = await service.start(7)
  const secondPartial: any = await waitRun(service, second.runId)
  assert.equal(secondPartial.status, 'partial'); assert.equal(secondPartial.searchProgress.pass, 2)
  assert.equal(test.metrics.sends, 0)
}

run().then(() => console.log('connection partial catalog tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
