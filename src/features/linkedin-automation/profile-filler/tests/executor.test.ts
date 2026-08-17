const assert = require('node:assert/strict')
const test = require('node:test')
const { executeProfilePlan, verifyProfile } = require('../executor.ts') as typeof import('../executor.ts')
const { FakeProfileClient } = require('./fake-profile-client.ts') as typeof import('./fake-profile-client.ts')
const { createMemoryLogger } = require('../../core/reporting/logger.ts') as typeof import('../../core/reporting/logger.ts')

const zeroTiming = {
  firstWrite: { min: 0, max: 0 }, ordinaryWrite: { min: 0, max: 0 },
  firstReadBack: { min: 0, max: 0 }, repeatedReadBack: { min: 0, max: 0 },
  skillsBatch: { min: 0, max: 0 }, apiRateLimitCushion: { min: 0, max: 0 },
}

function simplePlan() {
  return {
    account: { provider: 'linkedin' as const, accountId: 'a', displayName: 'Student', verifiedAt: '2026-08-17T00:00:00.000Z' },
    identity: { displayName: 'Student' },
    issues: [],
    steps: [
      { id: 'headline', section: 'headline' as const, action: 'update' as const, summary: 'Headline', before: 'Old', after: 'New', payload: { specifics: { linkedin: { headline: 'New' } } }, verification: { kind: 'headline' as const, expected: 'New' } },
      { id: 'about', section: 'about' as const, action: 'update' as const, summary: 'About', before: 'Old', after: 'New about', payload: { bio: 'New about' }, verification: { kind: 'about' as const, expected: 'New about' } },
    ],
  }
}

test('executor writes sequentially, read-backs every write and emits lifecycle logs', async () => {
  const { logger, entries } = createMemoryLogger({ minimumLevel: 'debug' })
  const client = new FakeProfileClient({ a: { display_name: 'Student', description: 'Old', bio: 'Old', specifics: {} } }, { logger })
  const waits: number[] = []
  const result = await executeProfilePlan(client, simplePlan(), {
    logger, timingPolicy: zeroTiming, verificationAttempts: 2,
    wait: async milliseconds => { waits.push(milliseconds) }, randomInt: minimum => minimum,
  })
  assert.equal(result.status, 'verified')
  assert.equal(client.writes.length, 2)
  assert.equal(client.reads.length, 2)
  assert.deepEqual(waits, [0, 0, 0, 0])
  const events = entries.map(entry => entry.event)
  for (const event of ['execution.started', 'step.write.started', 'step.write.succeeded', 'step.readback.verified', 'step.completed', 'execution.completed']) {
    assert.equal(events.includes(event), true, `missing log event ${event}`)
  }
})

test('executor stops after first read-back mismatch', async () => {
  const client = new FakeProfileClient({ a: { display_name: 'Student', description: 'Old', bio: 'Old', specifics: {} } }, { suppressMutationAt: 1 })
  const result = await executeProfilePlan(client, simplePlan(), {
    timingPolicy: zeroTiming, verificationAttempts: 2, wait: async () => undefined,
    randomInt: minimum => minimum,
  })
  assert.equal(result.status, 'failed')
  assert.equal(client.writes.length, 1)
  assert.equal(client.reads.length, 2)
  assert.equal(result.steps[0].status, 'failed')
})

test('Open to Work verification compares the requested configuration', () => {
  const expected = {
    job_title: [{ title: 'QA Engineer', id: 'title-1' }],
    workplace: [{ type: 'REMOTE', location: ['location-1'] }],
    employment_type: ['FULL_TIME'],
    visibility: 'RECRUITERS_ONLY',
  }
  assert.equal(verifyProfile({
    specifics: {
      is_open_to_work: true,
      open_to_work: { ...expected, visibility: 'ALL' },
    },
  }, { kind: 'open_to_work', expected }), false)
  assert.equal(verifyProfile({
    specifics: {
      is_open_to_work: true,
      open_to_work: { ...expected, provider_extra_field: true },
    },
  }, { kind: 'open_to_work', expected }), true)
})

test('executor performs read-back when write throws before applying', async () => {
  const client = new FakeProfileClient(
    { a: { display_name: 'Student', description: 'Old', bio: 'Old', specifics: {} } },
    { failWriteAt: 1 },
  )
  const result = await executeProfilePlan(client, simplePlan(), {
    timingPolicy: zeroTiming,
    verificationAttempts: 2,
    wait: async () => undefined,
    randomInt: minimum => minimum,
  })
  assert.equal(result.status, 'failed')
  assert.equal(client.writes.length, 1)
  assert.equal(client.reads.length, 2)
})

test('executor marks uncertain write verified only after matching read-back', async () => {
  const { logger, entries } = createMemoryLogger({ minimumLevel: 'debug' })
  const client = new FakeProfileClient(
    { a: { display_name: 'Student', description: 'Old', bio: 'Old', specifics: {} } },
    { throwAfterMutationAt: 1 },
  )
  const plan = simplePlan()
  plan.steps = [plan.steps[0]]
  const result = await executeProfilePlan(client, plan, {
    logger,
    timingPolicy: zeroTiming,
    verificationAttempts: 2,
    wait: async () => undefined,
    randomInt: minimum => minimum,
  })
  assert.equal(result.status, 'verified')
  assert.equal(client.writes.length, 1)
  assert.equal(client.reads.length, 1)
  assert.equal(entries.some(entry => entry.event === 'step.completed_after_write_error'), true)
})

test('executor honors cancellation before any write', async () => {
  const client = new FakeProfileClient({ a: { display_name: 'Student', description: 'Old', bio: 'Old', specifics: {} } })
  const result = await executeProfilePlan(client, simplePlan(), {
    timingPolicy: zeroTiming, wait: async () => undefined, shouldCancel: () => true,
  })
  assert.equal(result.status, 'cancelled')
  assert.equal(client.writes.length, 0)
})
