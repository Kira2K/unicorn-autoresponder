const assert: typeof import('node:assert/strict') = require('node:assert/strict')
import type { ProfileJob } from '../job-types.ts'
import type { JsonObject } from '../input-types.ts'
const { noWait, silent } = require('./stability-fixtures.ts') as typeof import('./stability-fixtures.ts')
const { createProfileFillerService } = require('../service.ts')

async function testPartialApply() {
  const records = new Map<string, ProfileJob>()
  const payloads: JsonObject[] = []
  const profile = { provider_id: 'mock', public_identifier: 'mock', description: 'Old',
    profile_url: 'https://www.linkedin.com/in/mock/', specifics: { experience: [], education: [], skills: [] } }
  const service = createProfileFillerService({ store: {
    async create(job: ProfileJob) { records.set(job.jobId, structuredClone(job)) },
    async update(id: string, patch: Partial<ProfileJob>) { Object.assign(records.get(id)!, structuredClone(patch)) },
    async get(id: string) { return structuredClone(records.get(id)) }
  }, repository: { async getAccount() { return { platformAccountId: 7, clientName: 'Mock',
    unipileAccountId: 'mock', unipileAccountStatus: 'running', verifiedProviderId: 'mock',
    lastVerifiedAt: '2026-09-10', linkedinUrl: profile.profile_url } } }, client: {
    async getAccount() { return { provider: 'linkedin', status: 'running', user_id: 'mock' } },
    async getOwnProfile() { return structuredClone(profile) },
    async searchParameters(_id: string, type: string, keywords: string) {
      assert.notEqual(type, 'SKILL')
      return [{ id: keywords, name: keywords }]
    },
    async updateOwnProfile(_id: string, payload: JsonObject) {
      assert.deepEqual(payload, { specifics: { linkedin: { headline: 'New' } } })
      payloads.push(payload)
      profile.description = 'New'
    }
  }, executorOptions: { timing: noWait, logger: silent, wait: async () => {} } })
  const started = await service.startPreview(7, { profile: { headline: 'New', education: [{ data: {
    school: 'University', start_date: '2017-09', end_date: '2021', degree: 'BSc' } }] } })
  let preview
  for (let i = 0; i < 40; i += 1) {
    preview = await service.get(started.jobId)
    if (preview.status === 'preview_ready') break
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(preview.status, 'preview_ready')
  assert.equal(preview.preview.canApply, true)
  assert.deepEqual(preview.preview.skippedChanges, ['profile.education[0]'])
  assert.equal(preview.preview.document.profile.education.length, 1, 'blocked facts remain visible')
  assert.equal(preview.preview.document.profile.education[0].data.end_date, '2021')
  assert.deepEqual(preview.preview.steps.map((step: { id: string }) => step.id), ['headline'])
  await assert.rejects(service.apply(started.jobId, 'wrong-hash'), { code: 'profile_plan_hash_mismatch' })
  await service.apply(started.jobId, preview.planHash)
  await assert.rejects(service.apply(started.jobId, preview.planHash), { code: 'profile_job_not_ready' })
  for (let i = 0; i < 60 && records.get(started.jobId)?.status !== 'needs_expert_review'; i += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(payloads.length, 1)
  const result = await service.get(started.jobId)
  assert.equal(result.status, 'needs_expert_review')
  assert.equal(result.phase, 'partially_completed')
  assert.deepEqual(result.result.steps.map((step: { status: string }) => step.status), ['verified'])
  assert.equal(result.rollbackAvailable, false)
}
module.exports = { testPartialApply }
