const assert = require('node:assert/strict')
const test = require('node:test')
const currentProfile = require('../fixtures/current-profile.json')
const profileInput = require('../fixtures/profile-input.json')
const { ProfileFillerService, ProfileValidationError } = require('../service.ts') as typeof import('../service.ts')
const { FakeProfileClient } = require('./fake-profile-client.ts') as typeof import('./fake-profile-client.ts')
const { AccountJobManager } = require('../job-manager.ts') as typeof import('../job-manager.ts')
const { InMemoryProfileSnapshotStore } = require('../profile-snapshot.ts') as typeof import('../profile-snapshot.ts')
const { createMemoryLogger } = require('../../core/reporting/logger.ts') as typeof import('../../core/reporting/logger.ts')

const zeroTiming = {
  firstWrite: { min: 0, max: 0 }, ordinaryWrite: { min: 0, max: 0 },
  firstReadBack: { min: 0, max: 0 }, repeatedReadBack: { min: 0, max: 0 },
  skillsBatch: { min: 0, max: 0 }, apiRateLimitCushion: { min: 0, max: 0 },
}
const account = {
  provider: 'linkedin' as const,
  accountId: 'account-1',
  displayName: 'Test Student',
  profileUrl: 'https://www.linkedin.com/in/test-student',
  verifiedAt: '2026-08-17T00:00:00.000Z',
}

test('service performs preview and confirmed mutation end-to-end with fake adapter only', async () => {
  const { logger, entries } = createMemoryLogger({ minimumLevel: 'debug' })
  const client = new FakeProfileClient({ 'account-1': currentProfile }, { logger })
  const service = new ProfileFillerService({
    client,
    logger,
    executorOptions: { timingPolicy: zeroTiming, wait: async () => undefined, randomInt: (minimum: number) => minimum },
  })
  const previewJob = service.startPreview(account, profileInput)
  const preview = await previewJob.result
  assert.equal(client.writes.length, 0)
  assert.equal(preview.steps.length > 0, true)
  assert.equal(preview.steps.every((step: object) => !('payload' in step) && !('verification' in step)), true)
  assert.equal(service.getJob(previewJob.jobId)?.type, 'read_only')

  const mutationJob = service.startMutation({
    planId: preview.planId,
    planHash: preview.planHash,
    accountId: account.accountId,
  })
  const result = await mutationJob.result
  assert.equal(result.status, 'verified')
  assert.equal(service.getJob(mutationJob.jobId)?.type, 'mutation')
  assert.equal(client.writes.length, preview.steps.length)
  const finalProfile = client.snapshot(account.accountId)
  assert.equal(finalProfile.description, 'QA Engineer (Manual & Automation)')
  assert.equal(finalProfile.bio, 'Updated about text')
  assert.equal((finalProfile.specifics as Record<string, unknown>).is_open_to_work, true)

  const events = new Set(entries.map(entry => entry.event))
  for (const event of ['validation.started', 'identity.verified', 'planner.completed', 'preview.created', 'preview.consumed', 'execution.completed', 'job.completed']) {
    assert.equal(events.has(event), true, `missing service log event ${event}`)
  }
  assert.equal(JSON.stringify(entries).includes('access_token'), false)
})

test('service rejects identity mismatch before creating a mutation plan', async () => {
  const client = new FakeProfileClient({ 'account-1': { ...currentProfile, profile_url: 'https://www.linkedin.com/in/other-student' } })
  const service = new ProfileFillerService({ client })
  const job = service.startPreview(account, profileInput)
  await assert.rejects(job.result, ProfileValidationError)
  assert.equal(client.writes.length, 0)
  assert.equal(service.getJob(job.jobId)?.status, 'failed')
})

test('preview snapshots account and profile input before queue execution', async () => {
  const client = new FakeProfileClient({
    a: { display_name: 'Student A', profile_url: 'https://www.linkedin.com/in/student-a', description: 'Old A', specifics: {} },
    b: { display_name: 'Student B', profile_url: 'https://www.linkedin.com/in/student-b', description: 'Old B', specifics: {} },
  })
  const service = new ProfileFillerService({ client })
  const mutableAccount = {
    provider: 'linkedin' as const,
    accountId: 'a',
    displayName: 'Student A',
    profileUrl: 'https://www.linkedin.com/in/student-a',
    verifiedAt: '2026-08-17T00:00:00.000Z',
  }
  const mutableProfile = { profile: { headline: 'Original headline' } }
  const job = service.startPreview(mutableAccount, mutableProfile)
  mutableAccount.accountId = 'b'
  mutableAccount.displayName = 'Student B'
  mutableAccount.profileUrl = 'https://www.linkedin.com/in/student-b'
  mutableProfile.profile.headline = 'Mutated headline'

  const preview = await job.result
  assert.equal(service.getJob(job.jobId)?.accountId, 'a')
  assert.equal(preview.account.accountId, 'a')
  assert.equal(preview.steps[0].after, 'Original headline')
  assert.equal(client.reads[0].accountId, 'a')
})

test('mutation snapshots plan binding before waiting in the account queue', async () => {
  const manager = new AccountJobManager()
  const client = new FakeProfileClient({
    a: { display_name: 'Student A', profile_url: 'https://www.linkedin.com/in/student-a', description: 'Old', specifics: {} },
  })
  const service = new ProfileFillerService({
    client,
    jobManager: manager,
    executorOptions: { timingPolicy: zeroTiming, wait: async () => undefined },
  })
  const accountA = {
    provider: 'linkedin' as const,
    accountId: 'a',
    displayName: 'Student A',
    profileUrl: 'https://www.linkedin.com/in/student-a',
    verifiedAt: '2026-08-17T00:00:00.000Z',
  }
  const preview = await service.startPreview(accountA, { profile: { headline: 'New' } }).result

  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const blocker = manager.enqueue({
    type: 'read_only',
    kind: 'test_blocker',
    accountId: 'a',
    run: async () => { await gate },
  })
  await new Promise(resolve => setImmediate(resolve))

  const mutableInput = { planId: preview.planId, planHash: preview.planHash, accountId: 'a' }
  const mutation = service.startMutation(mutableInput)
  mutableInput.accountId = 'b'
  mutableInput.planHash = 'tampered'
  release()
  await blocker.result
  const result = await mutation.result

  assert.equal(result.status, 'verified')
  assert.equal(result.accountId, 'a')
  assert.equal(client.writes[0].accountId, 'a')
})

test('fake write errors are redacted in logs and stop the plan', async () => {
  const { logger, entries } = createMemoryLogger({ minimumLevel: 'debug' })
  const client = new FakeProfileClient({ 'account-1': currentProfile }, { logger, failWriteAt: 1 })
  const service = new ProfileFillerService({
    client,
    logger,
    executorOptions: { timingPolicy: zeroTiming, wait: async () => undefined },
  })
  const preview = await service.startPreview(account, profileInput).result
  const result = await service.startMutation({ planId: preview.planId, planHash: preview.planHash, accountId: account.accountId }).result
  assert.equal(result.status, 'failed')
  const serialized = JSON.stringify(entries)
  assert.equal(serialized.includes('should-not-leak'), false)
  assert.equal(serialized.includes('[REDACTED]'), true)
})

test('missing Experience section is saved as missing and blocks create', async () => {
  const client = new FakeProfileClient({
    a: {
      display_name: 'Student A',
      profile_url: 'https://www.linkedin.com/in/student-a',
      specifics: {},
    },
  })
  const service = new ProfileFillerService({ client })
  const preview = await service.startPreview({
    provider: 'linkedin',
    accountId: 'a',
    displayName: 'Student A',
    profileUrl: 'https://www.linkedin.com/in/student-a',
    verifiedAt: '2026-08-17T00:00:00.000Z',
  }, {
    profile: {
      experience: [{
        action: 'upsert',
        data: {
          company: 'Existing Company',
          job_title: 'QA Engineer',
          start_date: { year: 2024, month: 1 },
          skills: [],
        },
      }],
    },
  }).result

  assert.equal(preview.sourceSnapshot?.sections.experience.status, 'missing')
  assert.equal(preview.steps.some((step: { section: string }) => step.section === 'experience'), false)
  assert.equal(preview.issues.some((issue: { path: string }) => issue.path === 'profile.experience'), true)
})

test('confirmed empty Experience section allows create', async () => {
  const client = new FakeProfileClient({
    a: {
      display_name: 'Student A',
      profile_url: 'https://www.linkedin.com/in/student-a',
      specifics: { experience: [] },
    },
  })
  const service = new ProfileFillerService({ client })
  const preview = await service.startPreview({
    provider: 'linkedin',
    accountId: 'a',
    displayName: 'Student A',
    profileUrl: 'https://www.linkedin.com/in/student-a',
    verifiedAt: '2026-08-17T00:00:00.000Z',
  }, {
    profile: {
      experience: [{
        action: 'upsert',
        data: {
          company: 'New Company',
          job_title: 'QA Engineer',
          start_date: { year: 2024, month: 1 },
          skills: [],
        },
      }],
    },
  }).result

  assert.equal(preview.sourceSnapshot?.sections.experience.status, 'empty')
  assert.equal(preview.steps.some((step: { section: string; action: string }) =>
    step.section === 'experience' && step.action === 'create'), true)
})

test('mutation is rejected when its saved read snapshot no longer exists', async () => {
  const snapshots = new InMemoryProfileSnapshotStore()
  const client = new FakeProfileClient({
    a: {
      display_name: 'Student A',
      profile_url: 'https://www.linkedin.com/in/student-a',
      description: 'Old',
      specifics: {},
    },
  })
  const service = new ProfileFillerService({ client, snapshotStore: snapshots })
  const preview = await service.startPreview({
    provider: 'linkedin',
    accountId: 'a',
    displayName: 'Student A',
    profileUrl: 'https://www.linkedin.com/in/student-a',
    verifiedAt: '2026-08-17T00:00:00.000Z',
  }, { profile: { headline: 'New' } }).result
  assert.ok(preview.sourceSnapshot)
  snapshots.delete(preview.sourceSnapshot.snapshotId)

  const mutation = service.startMutation({
    planId: preview.planId,
    planHash: preview.planHash,
    accountId: 'a',
  })
  await assert.rejects(mutation.result, /snapshot/i)
  assert.equal(client.writes.length, 0)
})
