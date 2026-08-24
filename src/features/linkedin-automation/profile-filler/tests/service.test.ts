const assert = require('node:assert/strict')
const { createProfileFillerService } = require('../service.ts') as any

const turn = () => new Promise(resolve => setImmediate(resolve))

async function settled(service: any, jobId: string, expected: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await service.get(jobId)
    if (job?.status === expected) return job
    await turn()
  }
  throw new Error(`Job did not reach ${expected}.`)
}

async function run() {
  const records = new Map<string, any>()
  const releases: string[] = []
  const profile: any = {
    public_identifier: 'student', provider_id: 'provider-1', name: 'Student',
    profile_url: 'https://www.linkedin.com/in/student/', description: 'Old', bio: '',
    specifics: { experience: [], education: [], skills: [] }
  }
  let acceptWrites = true
  const events: any[] = []
  const store = {
    async create(job: any) { records.set(job.jobId, job) },
    async update(id: string, patch: any) { Object.assign(records.get(id), patch) },
    async get(id: string) { return records.get(id) },
    async list() { return [...records.values()] }
  }
  const service = createProfileFillerService({
    repository: { async listAccounts() { return [{
      platformAccountId: 7, clientName: 'Student', linkedinUrl: profile.profile_url,
      unipileAccountId: 'acc-1', unipileAccountStatus: 'running',
      verifiedProviderId: 'provider-1', lastVerifiedAt: '2026-08-21T00:00:00.000Z'
    }] } },
    client: {
      async getAccount() { return { provider: 'linkedin', status: 'running', user_id: 'provider-1' } },
      async getOwnProfile() { return profile },
      async updateOwnProfile(_id: string, payload: any) {
        const headline = payload?.specifics?.linkedin?.headline
        if (acceptWrites && headline !== undefined) profile.description = headline
      }
    },
    store,
    gate: { acquire(kind: string) { return () => releases.push(kind) } },
    executorOptions: { wait: async () => undefined, random: () => 0,
      logger: { event: (...args: any[]) => events.push(args) } }
  })
  const started = await service.startPreview(7, {
    schema_version: 1, li_at: 'must-not-leak', proxy_password: 'must-not-leak',
    profile: { headline: 'New' }
  })
  const preview = await settled(service, started.jobId, 'preview_ready')
  assert.equal(preview.preview.steps[0].after, 'New')
  assert.equal(JSON.stringify(preview).includes('payload'), false)
  assert.equal(JSON.stringify(records.get(started.jobId)).includes('must-not-leak'), false)
  await assert.rejects(() => service.apply(started.jobId, 'wrong'), { code: 'profile_plan_hash_mismatch' })
  await service.apply(started.jobId, preview.planHash)
  const result = await settled(service, started.jobId, 'succeeded')
  assert.equal(result.result.status, 'verified')
  assert.ok(events.some(event => event[0] === 'input_validation' && event[1] === 'succeeded'))
  assert.ok(events.some(event => event[0] === 'account_profile_read' && event[1] === 'succeeded'))
  assert.ok(events.some(event => event[0] === 'write' && event[1] === 'started'))
  assert.ok(events.some(event => event[0] === 'job_finish_persist' && event[1] === 'succeeded'))
  assert.equal(records.get(started.jobId).result.steps[0].status, 'verified')
  assert.equal(result.rollbackAvailable, true)
  const rollback = await service.rollback(started.jobId)
  const restored = await settled(service, rollback.jobId, 'succeeded')
  assert.equal(restored.kind, 'rollback')
  assert.equal(profile.description, 'Old')
  await assert.rejects(() => service.rollback(started.jobId), { code: 'profile_already_rolled_back' })
  acceptWrites = false
  const retryStart = await service.startPreview(7, { profile: { headline: 'Late' } })
  const retryPreview = await settled(service, retryStart.jobId, 'preview_ready')
  await service.apply(retryStart.jobId, retryPreview.planHash)
  const failed = await settled(service, retryStart.jobId, 'pending_verification')
  assert.equal(failed.result.steps[0].failureKind, 'write_accepted_not_visible')
  assert.deepEqual(releases,
    ['profile_preview', 'profile_fill', 'profile_rollback', 'profile_preview', 'profile_fill'])
  records.set('stale-job', {
    jobId: 'stale-job', platformAccountId: 7, clientName: 'Student', status: 'running',
    phase: 'writing:headline', createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  })
  const recovered = createProfileFillerService({ store })
  const recoveredJobs = await recovered.list()
  assert.equal(recoveredJobs.find((item: any) => item.jobId === started.jobId).result.steps[0].status, 'verified')
  const stale = recoveredJobs.find((item: any) => item.jobId === 'stale-job')
  assert.equal(stale.status, 'needs_expert_review')
  assert.equal(stale.errorCode, 'profile_job_interrupted')
  records.set('blocked-job', {
    jobId: 'blocked-job', platformAccountId: 7, clientName: 'Student', status: 'preview_ready',
    phase: 'preview_ready', planHash: 'blocked-hash', createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), plan: { issues: [{ level: 'fatal' }], steps: [] }
  })
  await assert.rejects(() => service.apply('blocked-job', 'blocked-hash'),
    { code: 'profile_preview_has_blocking_issues' })
}

run().then(() => console.log('profile filler service tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
