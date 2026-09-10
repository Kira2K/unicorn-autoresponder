const assert: typeof import('node:assert/strict') = require('node:assert/strict')
import type { ProfileJob } from '../job-types.ts'
const { validateProfileFile } = require('../validator.ts') as typeof import('../validator.ts')
const { previewSaveFailure, previewSaveRecovery } = require('../preview-save-state.ts') as typeof import('../preview-save-state.ts')
const { publicProfileJob } = require('../job-types.ts') as typeof import('../job-types.ts')
const { profileReadView } = require('../job-state.ts') as typeof import('../job-state.ts')
const { NOOP_PROFILE_LOGGER } = require('../profile-logger.ts') as typeof import('../profile-logger.ts')
const { createProfileFillerService } = require('../service.ts') as { createProfileFillerService(options: unknown): {
  resume(id: string): Promise<ReturnType<typeof publicProfileJob>>
  stopGeneration(id: string): Promise<ReturnType<typeof publicProfileJob>>
} }

async function testPreviewSave() {
  const input = validateProfileFile({ profile: { headline: 'New' } }).value!
  const job: ProfileJob = { jobId: 'save-preview', platformAccountId: 7, clientName: 'Mock', accountId: 'mock',
    status: 'failed', phase: 'preview_failed', errorCode: 'noco_rate_limited', createdAt: '', updatedAt: '',
    checkpoint: { version: 1, stage: 'resolving_job_titles', profile: input, issues: [], generation: {
      model: 'mock', guideRevision: '1', cvRevision: '1', proxyCountry: 'Poland', generatedAt: '' } } }
  let saved = structuredClone(job), failReady = true, writes = 0, reads = 0, releaseSave: (() => void) | undefined
  const store = { async get() { return structuredClone(saved) }, async update(_id: string, patch: Partial<ProfileJob>) {
    writes++
    if (patch.status === 'preview_ready' && failReady) throw Object.assign(Error('rate limited'), {
      response: { status: 429, headers: { 'retry-after': '120' } } })
    if (patch.status === 'preview_ready') await new Promise<void>(resolve => { releaseSave = resolve })
    saved = { ...saved, ...structuredClone(patch) }
  } }
  const client = { async getAccount() { reads++; return { provider: 'linkedin', status: 'running', user_id: 'mock' } },
    async getOwnProfile() { reads++; return { id: 'mock', public_identifier: 'mock', description: 'Old',
      specifics: { experience: [], education: [], skills: [] } } },
    async searchParameters() { throw Error('no catalog expected') }, async updateOwnProfile() { throw Error('no LinkedIn PATCH') } }
  const options = { store, client, executorOptions: { logger: NOOP_PROFILE_LOGGER },
    repository: { async getAccount() { return { platformAccountId: 7, clientName: 'Mock', unipileAccountId: 'mock',
      unipileAccountStatus: 'running', lastVerifiedAt: '2026-09-10', verifiedProviderId: 'mock',
      linkedinUrl: 'https://www.linkedin.com/in/mock/' } } },
    generationRuntime: { get config() { throw Error('recovery must not initialize a model or load CV') } } }
  assert.equal(publicProfileJob(job).previewRecovery, 'rebuild')
  const service = createProfileFillerService(options)
  await service.resume(job.jobId)
  for (let i = 0; i < 60 && saved.status !== 'waiting_retry'; i++) await new Promise(setImmediate)
  assert.equal(saved.phase, 'waiting_preview_save')
  assert(saved.checkpoint!.pendingPreview?.plan)
  assert.equal(previewSaveRecovery(saved), 'save')
  assert.equal(profileReadView(saved, false).status, 'waiting_retry', 'restart preserves waiting, without recovery writes')
  const retryAt = Date.parse(publicProfileJob(saved).retry!.nextRetryAt!)
  assert(retryAt >= Date.now() + 118_000, 'full Retry-After, not a fixed 30-second timer')
  const requestCount = writes
  await assert.rejects(service.resume(job.jobId), { code: 'noco_rate_limited' })
  assert.equal(writes, requestCount, 'early retry cannot hit Noco')
  saved.checkpoint!.pendingPreview!.nextRetryAt = '2020-01-01'
  failReady = false
  const restarted = createProfileFillerService(options)
  const continuing = restarted.resume(job.jobId)
  for (let i = 0; i < 20 && !releaseSave; i++) await new Promise(setImmediate)
  await assert.rejects(restarted.resume(job.jobId), { code: 'profile_retry_not_ready' })
  releaseSave!()
  const ready = await continuing
  assert.equal(ready.status, 'preview_ready'); assert.equal(saved.checkpoint, null)
  assert.equal(reads, 2, 'saving a prepared plan does not reread Unipile')
  assert.equal(writes, requestCount + 1, 'one known-record update; no new job or duplicate save')
  assert.equal(ready.preview?.document?.profile !== undefined, true)
  const pending = { ...job, checkpoint: { ...job.checkpoint!, pendingPreview: {
    plan: saved.plan!, planHash: saved.planHash! } } }
  const now = Date.parse('2026-09-10T00:00:00Z')
  assert.equal(previewSaveFailure(pending, {}, now).checkpoint!.pendingPreview!.nextRetryAt, '2026-09-10T00:00:30.000Z')
  assert.equal(previewSaveFailure(pending, { details: { retryAfterMs: 180_000 } }, now)
    .checkpoint!.pendingPreview!.nextRetryAt, '2026-09-10T00:03:00.000Z')
  assert.equal(previewSaveRecovery({ ...pending, phase: 'generation_stopped' }), undefined)
  assert.equal(previewSaveRecovery({ ...pending, result: { status: 'verified', steps: [] } }), undefined)
  const stopped = { ...pending, status: 'waiting_retry' as const, phase: 'waiting_preview_save' }
  saved = structuredClone(stopped)
  const stopper = createProfileFillerService(options)
  await stopper.stopGeneration(job.jobId)
  await assert.rejects(stopper.resume(job.jobId), { code: 'profile_generation_stopped' })
}
module.exports = { testPreviewSave }
