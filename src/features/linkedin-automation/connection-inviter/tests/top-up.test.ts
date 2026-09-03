const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function thresholdDoesNotIncreaseQuota() {
  const now = new Date('2026-08-29T09:00:00Z')
  const test = fixture({ stack: 'GO', connectionCount: 1000 })
  const seeded = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  seeded.status = 'partial'; seeded.stage = 'search_exhausted'
  seeded.connectionCount = 999; seeded.dailyLimit = 38; seeded.dailyQuota = 38
  seeded.audienceQuota = { recruiter: 27, technical: 11 }; seeded.finishedAt = now.toISOString()
  await test.store.createRun(seeded)
  for (let index = 0; index < 37; index += 1) {
    const audience = index < 27 ? 'recruiter' : 'technical'
    await test.store.claimHistory({ historyKey: `acc_test:frozen-${index}`,
      runId: seeded.runId, platformAccountId: 7, accountId: 'acc_test',
      personId: `frozen-${index}`, audience, searchKey: 'frozen', name: `Frozen ${index}`,
      headline: audience === 'recruiter' ? 'Recruiter' : 'GO Engineer', location: 'Berlin',
      status: 'sent', reasonCode: 'pending_readback_confirmed', discoveredAt: now.toISOString(),
      updatedAt: now.toISOString(), sentAt: now.toISOString(), verifiedAt: now.toISOString() })
  }
  const service = createConnectionInviterService({ ...test, now: () => now,
    sleep: async () => undefined })
  const resumed: any = await service.start(7)
  const completed: any = await waitRun(service, resumed.runId)
  const internal: any = await test.store.getRun(resumed.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.counters.sent, 38)
  assert.equal(test.metrics.sends, 1)
  assert.equal(internal.connectionCount, 999); assert.equal(internal.dailyLimit, 38)
  assert.deepEqual(internal.audienceQuota, { recruiter: 27, technical: 11 })
}

async function recruiterOnlyCanResumeTechnicalAfterStackSelection() {
  const now = new Date('2026-08-29T09:00:00Z')
  const test = fixture({ connectionCount: 149 })
  const service = createConnectionInviterService({ ...test, now: () => now,
    sleep: async () => undefined })
  const safe: any = await service.start(7, { safeRecruiterOnly: true })
  const recruiterOnly: any = await waitRun(service, safe.runId)
  assert.equal(recruiterOnly.status, 'partial')
  assert.equal(recruiterOnly.stage, 'search_exhausted')
  assert.deepEqual(recruiterOnly.audienceQuota, { recruiter: 4, technical: 1 })
  assert.deepEqual(recruiterOnly.counters.shortfallByAudience,
    { recruiter: 0, technical: 1 })
  assert.equal(test.metrics.sends, 4)
  await service.saveStack(7, 10)
  const resumed: any = await service.start(7)
  const completed: any = await waitRun(service, resumed.runId)
  assert.equal(completed.status, 'succeeded')
  assert.deepEqual(completed.audienceQuota, { recruiter: 4, technical: 1 })
  assert.equal(completed.counters.sent, 5); assert.equal(test.metrics.sends, 5)
}

async function run() {
  const now = new Date('2026-08-29T09:00:00Z')
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const seeded = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  seeded.status = 'partial'; seeded.stage = 'search_exhausted'
  seeded.connectionCount = 1663; seeded.dailyLimit = 40; seeded.dailyQuota = 40
  seeded.audienceQuota = { recruiter: 28, technical: 12 }; seeded.counters.sent = 2
  seeded.searchProgress.recentSearchAt = ['2026-08-29T08:58:00.000Z']
  seeded.searchProgress.locations.Berlin = { status: 'resolved', city: 'Berlin', id: 'geo-berlin',
    label: 'Berlin', resolvedAt: '2026-08-29T08:58:00.000Z' }
  seeded.finishedAt = now.toISOString()
  const created = await test.store.createRun(seeded)
  let nocoBudgetResets = 0
  const resettableStore = test.store as typeof test.store & {
    resetNocoBudget(runId: string): void
  }
  resettableStore.resetNocoBudget = (runId: string) => {
    assert.equal(runId, created.run.runId); nocoBudgetResets += 1
  }
  for (let index = 1; index <= 2; index += 1) {
    await test.store.claimHistory({
      historyKey: `acc_test:existing-${index}`, runId: created.run.runId,
      platformAccountId: 7, accountId: 'acc_test', personId: `existing-${index}`,
      audience: 'recruiter', searchKey: 'existing', name: `Existing ${index}`,
      headline: 'Technical Recruiter', location: 'Berlin', status: 'sent',
      reasonCode: 'pending_readback_confirmed', discoveredAt: now.toISOString(),
      updatedAt: now.toISOString(), sentAt: now.toISOString(), verifiedAt: now.toISOString()
    })
  }
  const service = createConnectionInviterService({ ...test, now: () => now,
    sleep: async () => undefined })
  const resumed: any = await service.start(7)
  assert.equal(resumed.status, 'running')
  assert.equal(nocoBudgetResets, 1)
  const internalResumed: any = await test.store.getRun(resumed.runId)
  assert.equal(internalResumed.searchProgress.recentSearchAt
    .includes('2026-08-29T08:58:00.000Z'), true)
  assert.equal(internalResumed.searchProgress.locations.Berlin.id, 'geo-berlin')
  const completed: any = await waitRun(service, resumed.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.stage, 'completed')
  assert.equal(completed.counters.sent, 40); assert.equal(test.metrics.sends, 38)
  await service.start(7)
  assert.equal(test.metrics.sends, 38)
  await thresholdDoesNotIncreaseQuota()
  await recruiterOnlyCanResumeTechnicalAfterStackSelection()
}

run().then(() => console.log('connection daily top-up tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
