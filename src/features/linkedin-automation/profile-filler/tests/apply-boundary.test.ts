const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createProfileFillerService } = require('../service.ts')
const { noWait, silent } = require('./stability-fixtures.ts')
type Job = import('../job-types.ts').ProfileJob

async function testApplyBoundary() {
  const records = new Map<string, Job>()
  const saves: Partial<Job>[] = []
  const accountReads: boolean[] = []
  const profile = { provider_id: 'mock', public_identifier: 'mock', description: 'Old', bio: 'Old',
    profile_url: 'https://www.linkedin.com/in/mock/' }
  let writes = 0, paused = true
  let proceed!: () => void
  const barrier = new Promise<void>(resolve => { proceed = resolve })
  const store = {
    async create(job: Job) { records.set(job.jobId, structuredClone(job)) },
    async update(id: string, patch: Partial<Job>) {
      saves.push(structuredClone(patch))
      Object.assign(records.get(id)!, structuredClone(patch))
    },
    async get(id: string) { return structuredClone(records.get(id)) }
  }
  const service = createProfileFillerService({ store, repository: {
    async getAccount(id: number, options: { fresh: boolean }) {
      assert.equal(id, 7)
      accountReads.push(options.fresh)
      return { platformAccountId: 7, clientName: 'Mock', unipileAccountId: 'mock',
        unipileAccountStatus: 'running', verifiedProviderId: 'mock', lastVerifiedAt: '2026-09-10',
        linkedinUrl: profile.profile_url }
    }
  }, client: {
    async getAccount() { return { provider: 'linkedin', status: 'running', user_id: 'mock' } },
    async getOwnProfile() { return structuredClone(profile) },
    async updateOwnProfile(_id: string, payload: { bio?: string; specifics?: { linkedin: { headline: string } } }) {
      assert.equal(saves.at(-1)?.status, 'running')
      assert.ok(saves.at(-1)?.result?.steps[writes].writeIntent)
      writes += 1
      if (payload.bio) profile.bio = payload.bio
      else profile.description = payload.specifics!.linkedin.headline
    }
  }, executorOptions: { timing: noWait, logger: silent,
    wait: async () => { if (paused) { paused = false; await barrier } } } })
  const created = await service.startPreview(7, { profile: { headline: 'New', about: 'New' } })
  let ready
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ready = await service.get(created.jobId)
    if (ready.status === 'preview_ready') break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(ready.status, 'preview_ready')
  saves.length = 0
  try {
    await service.apply(created.jobId, ready.planHash)
    assert.equal(saves.length, 0, 'Apply starting is saved with the first intent, not separately')
    assert.equal(writes, 0)
    await assert.rejects(service.apply(created.jobId, ready.planHash), { code: 'profile_job_not_ready' })
    const restarted = createProfileFillerService({ store, executorOptions: { logger: silent } })
    assert.equal((await restarted.get(created.jobId)).status, 'preview_ready')
    assert.equal(writes, 0, 'a restart before intent does not initiate a mutation')
  } finally { proceed() }
  for (let attempt = 0; attempt < 50 && records.get(created.jobId)?.status !== 'succeeded'; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.deepEqual(accountReads, [false, true], 'Apply performs a fresh account read')
  assert.equal(writes, 2)
  assert.equal(saves.length, 6)
  assert.equal(records.get(created.jobId)?.status, 'succeeded')
}
module.exports = { testApplyBoundary }
