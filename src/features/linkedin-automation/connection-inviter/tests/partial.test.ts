const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
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
  const failed: any = await waitRun(service, started.runId)
  assert.equal(failed.status, 'partial'); assert.equal(failed.stage, 'search_exhausted')
  assert.equal(failed.errorCode, 'connection_search_space_exhausted')
  assert.equal(failed.counters.sent, 0); assert.equal(test.metrics.sends, 0)
  assert.deepEqual(failed.counters.shortfallByAudience, { recruiter: 4, technical: 1 })
  assert.equal(failed.searchProgress.exhausted.recruiter, true)
  assert.equal(failed.searchProgress.exhausted.technical, true)
  assert.equal(failed.skipReasonCounters['hard:role_mismatch'] > 0, true)
  assert.equal(failed.skipReasonCounters['soft:city_outside_target'] > 0, true)
  assert.deepEqual(await service.history(7), [])
  const second: any = await service.start(7)
  const secondFailed: any = await waitRun(service, second.runId)
  assert.equal(secondFailed.status, 'partial'); assert.equal(secondFailed.searchProgress.pass, 2)
  assert.equal(test.metrics.sends, 0)

  const empty = fixture({ stack: 'GO', connectionCount: 149 })
  const primaryCities = ['London', 'Berlin', 'Amsterdam', 'Paris']
  empty.store.listCatalog = async () => [
    ...primaryCities.map((city, index) => ({
      sourceKey: `recruiter-city-${index}`, audience: 'recruiter', city,
      keywordTemplate: 'Recruiter', priority: index + 1, enabled: true
    })),
    { sourceKey: 'technical-city', audience: 'technical', city: 'Tech City',
      keywordTemplate: '{stack} Engineer', priority: 100, enabled: true }
  ] as any
  let emptySearches = 0
  empty.adapter.searchPeople = async () => { emptySearches += 1; return { items: [] } }
  const guardedService = createConnectionInviterService({ ...empty,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const guardedStart: any = await guardedService.start(7)
  const guarded: any = await waitRun(guardedService, guardedStart.runId)
  assert.equal(guarded.status, 'partial')
  assert.equal(guarded.stage, 'search_contract_suspect')
  assert.equal(guarded.errorCode, 'connection_search_contract_suspect')
  assert.equal(guarded.searchProgress.consecutiveEmptyRecruiterSearches, 20)
  assert.deepEqual(guarded.counters.shortfallByAudience, { recruiter: 4, technical: 1 })
  assert.equal(emptySearches, 20)
  assert.equal(empty.metrics.sends, 0)

  const split = fixture({ stack: 'GO', connectionCount: 1663 })
  split.store.listCatalog = async () => [
    { sourceKey: 'recruiter-exhausted', audience: 'recruiter', city: 'Berlin',
      keywordTemplate: 'Recruiter', priority: 1, enabled: true },
    { sourceKey: 'technical-continues', audience: 'technical', city: 'Berlin',
      keywordTemplate: '{stack} Engineer', priority: 2, enabled: true }
  ] as any
  let personIndex = 0
  split.adapter.searchPeople = async (_accountId: string, input: { keywords: string }) => {
    const technical = /Golang|\bGo\b|Developer|Engineer|Tech Lead/i.test(input.keywords) &&
      !/Recruiter|Talent|Sourcer|HRBP|Human Resources|People/i.test(input.keywords)
    return { items: Array.from({ length: 4 }, () => ({ id: `split-${++personIndex}`,
      display_name: `Split ${personIndex}`,
      headline: technical ? 'Golang Software Engineer' : 'Account Executive',
      location: 'Berlin', network_distance: 2 })) }
  }
  const splitRun = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, new Date('2026-08-29T09:00:00Z'), 'Europe/Moscow', false)
  splitRun.status = 'partial'; splitRun.stage = 'search_exhausted'
  splitRun.connectionCount = 1663; splitRun.dailyLimit = 40; splitRun.dailyQuota = 40
  splitRun.audienceQuota = { recruiter: 28, technical: 12 }
  splitRun.finishedAt = new Date('2026-08-29T09:00:00Z').toISOString()
  await split.store.createRun(splitRun)
  for (let index = 0; index < 20; index += 1) {
    await split.store.claimHistory({ historyKey: `acc_test:existing-recruiter-${index}`,
      runId: splitRun.runId, platformAccountId: 7, accountId: 'acc_test',
      personId: `existing-recruiter-${index}`, audience: 'recruiter', searchKey: 'existing',
      name: `Existing ${index}`, headline: 'Recruiter', location: 'Berlin', status: 'sent',
      reasonCode: 'pending_readback_confirmed', discoveredAt: splitRun.createdAt,
      updatedAt: splitRun.createdAt, sentAt: splitRun.createdAt, verifiedAt: splitRun.createdAt })
  }
  const splitService = createConnectionInviterService({ ...split,
    now: () => new Date('2026-08-29T09:00:00Z'), random: () => 0,
    sleep: async () => undefined })
  const splitStarted: any = await splitService.start(7)
  const splitResult: any = await waitRun(splitService, splitStarted.runId)
  assert.equal(splitResult.status, 'partial')
  assert.equal(splitResult.counters.sent, 32)
  assert.deepEqual(splitResult.counters.sentByAudience, { recruiter: 20, technical: 12 })
  assert.deepEqual(splitResult.counters.shortfallByAudience, { recruiter: 8, technical: 0 })
  assert.equal(split.metrics.sends, 12)
}

run().then(() => console.log('connection partial catalog tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
