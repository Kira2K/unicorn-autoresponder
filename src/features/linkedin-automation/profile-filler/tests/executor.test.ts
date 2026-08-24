const assert = require('node:assert/strict')
const { executeProfilePlan } = require('../executor.ts') as any
const { createProfileLogger } = require('../profile-logger.ts') as any

const zero = { min: 0, max: 0 }
const timing = { firstWrite: zero, ordinaryWrite: zero, readBack: zero,
  finalReadBack: zero, skillsBatch: zero }
const plan = { account: { accountId: 'acc_1' }, identity: {}, input: {}, issues: [], steps: [{
  id: 'headline', section: 'headline', action: 'update', summary: 'Headline',
  before: 'Old', after: 'New', payload: { specifics: { linkedin: { headline: 'New' } } },
  verification: { kind: 'headline', expected: 'New' }
}] }

async function run() {
  const profile: any = { description: 'Old' }
  let reads = 0
  const events: any[] = []
  const progress: any[] = []
  const delayed = await executeProfilePlan({
    async updateOwnProfile() {},
    async getOwnProfile() { if (++reads === 2) profile.description = 'New'; return structuredClone(profile) }
  }, plan, { timing, wait: async () => undefined,
    logger: { event: (...args: any[]) => events.push(args) },
    onProgress: (result: any) => progress.push(structuredClone(result)) })
  assert.equal(delayed.status, 'verified')
  assert.equal(delayed.steps[0].status, 'verified')
  assert.ok(progress.some(result => result.steps[0].status === 'write_accepted'))
  assert.equal(reads, 2)
  assert.ok(progress.some(result => result.steps[0].attempt === 1))
  assert.equal(progress.some(result => result.steps[0].maxAttempts > 1), false)
  assert.ok(progress.some(result => result.steps[0].nextActionAt))
  assert.equal(typeof delayed.steps[0].durationMs, 'number')
  assert.ok(delayed.startedAt && delayed.finishedAt)
  assert.equal(JSON.stringify(events).includes('New'), false)

  let stableReads = 0
  const stable = await executeProfilePlan({
    async updateOwnProfile() {},
    async getOwnProfile() { stableReads += 1; return { description: 'New' } }
  }, plan, { timing, wait: async () => undefined })
  assert.equal(stable.status, 'verified')
  assert.equal(stableReads, 2)

  let finalReads = 0
  let finalWrites = 0
  const finalWaits: number[] = []
  const finalVerified = await executeProfilePlan({
    async updateOwnProfile() { finalWrites += 1 },
    async getOwnProfile() {
      finalReads += 1
      return { description: finalReads >= 2 ? 'New' : 'Old' }
    }
  }, plan, { timing: { ...timing, finalReadBack: { min: 55, max: 65 } },
    wait: async (milliseconds: number) => { finalWaits.push(milliseconds) },
    random: (minimum: number) => minimum === 55 ? 60 : minimum })
  assert.equal(finalVerified.status, 'verified')
  assert.equal(finalWrites, 1)
  assert.equal(finalReads, 2)
  assert.deepEqual(finalWaits, [0, 0, 60000])

  const unchanged = await executeProfilePlan({ async updateOwnProfile() {},
    async getOwnProfile() { return { description: 'Old' } } }, plan,
  { timing, wait: async () => undefined })
  assert.equal(unchanged.status, 'pending_verification')
  assert.equal(unchanged.steps[0].status, 'verification_delayed')
  assert.equal(unchanged.steps[0].failureKind, 'write_accepted_not_visible')
  assert.ok(unchanged.finishedAt)

  const mismatch = await executeProfilePlan({ async updateOwnProfile() {},
    async getOwnProfile() { return { description: 'Different' } } }, plan,
  { timing, wait: async () => undefined })
  assert.equal(mismatch.status, 'pending_verification')
  assert.equal(mismatch.steps[0].failureKind, 'value_mismatch')

  const rejected = await executeProfilePlan({
    async updateOwnProfile() { throw Object.assign(new Error('secret response'), {
      code: 'unipile_rejected', details: { httpStatus: 422, requestId: 'req-safe',
        diagnostic: 'experience.job_title.required.name', secret: 'must-not-leak' }
    }) },
    async getOwnProfile() { return { description: 'Old' } }
  }, plan, { timing, wait: async () => undefined })
  assert.equal(rejected.steps[0].failureKind, 'write_rejected')
  assert.equal(rejected.steps[0].errorCode, 'unipile_rejected')
  assert.ok(JSON.stringify(events).includes('New') === false)

  const lines: string[] = []
  const logger = createProfileLogger({ jobId: 'job-1', writeLine: (line: string) => lines.push(line) })
  logger.event('write profile', 'failed', { stepId: 'headline', section: 'headline',
    errorCode: 'unipile_rejected', accessToken: 'must-not-leak' } as any)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].includes('must-not-leak'), false)
  logger.event('write', 'failed', { httpStatus: 422, requestId: 'req-safe',
    diagnostic: 'experience.job_title.required.name', payloadFields: ['experience', 'job_title'] })
  assert.match(lines[1], /"httpStatus":422/)
  assert.match(lines[1], /experience_job_title_required_name/)
  logger.event('write', 'failed', { diagnostic: 'must-not-leak' })
  assert.equal(lines[2].includes('must-not-leak'), false)
}

run().then(() => console.log('profile executor tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
