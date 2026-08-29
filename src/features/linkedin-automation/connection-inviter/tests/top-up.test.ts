const assert = require('node:assert/strict')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { makeRun } = require('../run-model.ts') as typeof import('../run-model.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

async function run() {
  const now = new Date('2026-08-29T09:00:00Z')
  const test = fixture({ stack: 'GO', connectionCount: 1663 })
  const seeded = makeRun({ platformAccountId: 7, clientId: 3, clientName: 'Test Client',
    linkedinUrl: 'https://www.linkedin.com/in/test-client/', accountId: 'acc_test',
    stackId: 10, stack: 'GO' }, now, 'Europe/Moscow', false)
  seeded.status = 'succeeded'; seeded.stage = 'completed_shortfall'
  seeded.connectionCount = 1663; seeded.dailyLimit = 40; seeded.dailyQuota = 40
  seeded.audienceQuota = { recruiter: 28, technical: 12 }; seeded.counters.sent = 2
  seeded.finishedAt = now.toISOString()
  const created = await test.store.createRun(seeded)
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
  const completed: any = await waitRun(service, resumed.runId)
  assert.equal(completed.status, 'succeeded'); assert.equal(completed.stage, 'completed')
  assert.equal(completed.counters.sent, 40); assert.equal(test.metrics.sends, 38)
  await service.start(7)
  assert.equal(test.metrics.sends, 38)
}

run().then(() => console.log('connection daily top-up tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
