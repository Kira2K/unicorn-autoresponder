const assert = require('node:assert/strict')
const { executeProfilePlan, resumeProfileVerification } = require('../executor.ts') as any
const { createProfileLogger } = require('../profile-logger.ts') as any
const { DEFAULT_TIMING } = require('../timing.ts') as any
const { observeProfile } = require('../observe.ts') as any

assert.deepEqual(DEFAULT_TIMING.ordinaryWrite, { min: 25, max: 70 })

const zero = { min: 0, max: 0 }
const timing = { firstWrite: zero, ordinaryWrite: zero, readBack: zero,
  finalReadBack: zero, skillsBatch: zero }
const plan = { account: { accountId: 'acc_1' }, identity: {}, input: {}, issues: [], steps: [{
  id: 'headline', section: 'headline', action: 'update', summary: 'Headline',
  before: 'Old', after: 'New', payload: { specifics: { linkedin: { headline: 'New' } } },
  verification: { kind: 'headline', expected: 'New' }
}] }

async function run() {
  const skillObservation = observeProfile({ specifics: { throttled_sections: ['skills'] } }, {
    id: 'skills-1', section: 'skills', verification: { kind: 'skills', expected: ['Go'] }
  })
  assert.equal(skillObservation, 'unavailable')
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
  assert.equal(reads, 3)
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

  let scheduledReads = 0
  const scheduled = await executeProfilePlan({
    async updateOwnProfile() {},
    async getOwnProfile() {
      scheduledReads += 1
      return { description: scheduledReads >= 4 ? 'New' : 'Old' }
    }
  }, plan, { timing: { ...timing, verificationScheduleSeconds: [0, 0] },
    wait: async () => undefined })
  assert.equal(scheduled.status, 'verified')
  assert.equal(scheduled.verification.attempt, 2)
  assert.equal(scheduledReads, 4)

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
    clock: () => Date.parse('2026-09-05T10:00:00.000Z'),
    wait: async (milliseconds: number) => { finalWaits.push(milliseconds) },
    random: (minimum: number) => minimum === 55 ? 60 : minimum })
  assert.equal(finalVerified.status, 'verified')
  assert.equal(finalWrites, 1)
  assert.equal(finalReads, 3)
  assert.deepEqual(finalWaits, [0, 0, 60000])

  const unchanged = await executeProfilePlan({ async updateOwnProfile() {},
    async getOwnProfile() { return { description: 'Old' } } }, plan,
  { timing, wait: async () => undefined })
  assert.equal(unchanged.status, 'failed')
  assert.equal(unchanged.steps[0].status, 'failed')
  assert.equal(unchanged.steps[0].failureKind, 'write_accepted_not_visible')
  assert.ok(unchanged.finishedAt)

  const mismatch = await executeProfilePlan({ async updateOwnProfile() {},
    async getOwnProfile() { return { description: 'Different' } } }, plan,
  { timing, wait: async () => undefined })
  assert.equal(mismatch.status, 'failed')
  assert.equal(mismatch.steps[0].failureKind, 'value_mismatch')

  let rejectedWrites = 0
  const rejected = await executeProfilePlan({
    async updateOwnProfile() { rejectedWrites += 1; throw Object.assign(new Error('secret response'), {
      code: 'unipile_rejected', details: { httpStatus: 422, requestId: 'req-safe',
        diagnostic: 'experience.job_title.required.name', secret: 'must-not-leak' }
    }) },
    async getOwnProfile() { return { description: 'Old' } }
  }, plan, { timing, wait: async () => undefined })
  assert.equal(rejected.steps[0].failureKind, 'write_rejected')
  assert.equal(rejected.steps[0].errorCode, 'unipile_rejected')
  assert.equal(rejected.steps[0].status, 'pending_retry')
  assert.equal(rejected.status, 'failed')
  assert.equal(rejectedWrites, 1)
  assert.ok(JSON.stringify(events).includes('New') === false)

  let uncertainWrites = 0
  const uncertainPlan = { ...plan, steps: [{ id: 'experience-1', section: 'experience',
    action: 'create', summary: 'Experience', before: null, after: {},
    payload: { specifics: { linkedin: { experience: { operation: 'create',
      job_title: { name: 'Engineer' }, company: { name: 'Acme' },
      start_date: { year: 2024, month: 1 } } } } },
    verification: { kind: 'experience', expected: { company: 'Acme', jobTitle: 'Engineer',
      startDate: { year: 2024, month: 1 }, skills: [] } } }] }
  const uncertain = await executeProfilePlan({
    async updateOwnProfile() { uncertainWrites += 1; throw Object.assign(new Error('lost'), {
      code: 'unipile_http_503', details: { httpStatus: 503 } }) },
    async getOwnProfile() { return { specifics: { experience: [], skills: [] } } }
  }, uncertainPlan, { timing, wait: async () => undefined })
  assert.equal(uncertainWrites, 1)
  assert.equal(uncertain.steps[0].failureKind, 'write_uncertain')
  assert.equal(uncertain.status, 'failed')

  const partialSkillsPlan = { ...plan, steps: [{ id: 'skills-1', section: 'skills', action: 'add',
    summary: 'Skills', before: { count: 0 }, after: { count: 2 },
    payload: { specifics: { linkedin: { skills: [{ name: 'Go' }, { name: 'SQL' }] } } },
    verification: { kind: 'skills', expected: ['Go', 'SQL'] } }] }
  let skillReads = 0
  const partialSkills = await executeProfilePlan({ async updateOwnProfile() {},
    async getOwnProfile() { skillReads += 1; return { specifics: {
      skills: skillReads === 1 ? [] : [{ name: 'Go' }] } } }
  }, partialSkillsPlan, { timing, wait: async () => undefined })
  assert.equal(partialSkills.status, 'failed')
  assert.equal(partialSkills.steps[0].status, 'failed')

  const continuingPlan = { ...plan, steps: [plan.steps[0], {
    id: 'about', section: 'about', action: 'update', summary: 'About', before: 'Old', after: 'New',
    payload: { bio: 'New' }, verification: { kind: 'about', expected: 'New' }
  }] }
  const continuedProfile: any = { description: 'Old', bio: 'Old' }
  const continued = await executeProfilePlan({
    async updateOwnProfile(_id: string, payload: any) {
      if (payload.specifics) throw Object.assign(new Error('rejected'), { code: 'unipile_rejected' })
      continuedProfile.bio = 'New'
    },
    async getOwnProfile() { return structuredClone(continuedProfile) }
  }, continuingPlan, { timing, wait: async () => undefined })
  assert.equal(continued.steps[0].status, 'pending_retry')
  assert.equal(continued.steps[1].status, 'verified')

  let resumedWrites = 0
  const resumed = await resumeProfileVerification({
    async updateOwnProfile() { resumedWrites += 1 },
    async getOwnProfile(_id: string, _sections: string[], options: any) {
      assert.deepEqual(options, { fresh: true })
      return { description: 'New' }
    }
  }, plan, { status: 'verifying', startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(), verification: { attempt: 1, maxAttempts: 2,
      nextReadBackAt: new Date(0).toISOString() }, steps: [{ stepId: 'headline',
      section: 'headline', status: 'verifying', message: 'Checking', attempt: 1,
      maxAttempts: 2, nextActionAt: new Date(0).toISOString() }] },
  { timing: { ...timing, verificationScheduleSeconds: [0, 0] }, wait: async () => undefined,
    clock: () => 0 })
  assert.equal(resumed.status, 'verified')
  assert.equal(resumedWrites, 0)

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
