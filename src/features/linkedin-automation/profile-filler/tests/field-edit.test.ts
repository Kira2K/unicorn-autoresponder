import assert from 'node:assert/strict'
import { editProfileField } from '../edit-field.ts'
import { buildProfilePlan } from '../planner.ts'
import { validateProfileFile } from '../validator.ts'
import { NOOP_PROFILE_LOGGER as logger } from '../profile-logger.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileClient } from '../plan-types.ts'
import { testFieldChange } from './field-change.test.ts'
import { testV2BlockSelection } from './field-v2-blocks.test.ts'

export async function testFieldEdits() {
  await testV2BlockSelection()
  testFieldChange()
  let reads = 0, searches = 0, saves = 0, locked = false, failSave = false
  const current = { provider_id: 'mock', description: 'Before', specifics: { experience: [], education: [], skills: [] } }
  const client: ProfileClient = {
    async getAccount() { throw new Error('unnecessary account request') },
    async getOwnProfile(_id, _sections, options) { assert.equal(options?.fresh, true); reads++; return structuredClone(current) },
    async searchParameters(_id, type) { assert.notEqual(type, 'SKILL'); searches++; return [] },
    async updateOwnProfile() { throw new Error('editing must never write to LinkedIn') }
  }
  const input = validateProfileFile({ profile: { headline: 'Engineer', education: [{ data: {
    school: 'University', degree: 'BSc', start_date: '2017-09', end_date: '2021' } }] } }).value!
  input.education[0].factId = 'edu_1'
  const plan = await buildProfilePlan(client, { accountId: 'mock', providerId: 'mock',
    platformAccountId: 7, clientName: 'Mock', profileUrl: '' }, input, current, [], logger)
  plan.issues.push({ level: 'warning', path: 'profile.skills.omitted', message: 'Preserve this omission', suggestions: ['Unavailable'] })
  const job: ProfileJob = { jobId: 'editing', platformAccountId: 7, clientName: 'Mock', status: 'preview_ready',
    phase: 'preview_ready', plan, planHash: 'old-hash', createdAt: '2026-09-10', updatedAt: '2026-09-10' }
  const jobs = new Map([[job.jobId, job]])
  const options = { jobs, client, logger, jobId: job.jobId, acquire() {
    if (locked) throw Object.assign(new Error('active'), { code: 'linkedin_operation_active' })
    locked = true; return () => { locked = false }
  }, store: { async get() { return undefined }, async update() {
    saves++; if (failSave) throw new Error('unavailable')
  } } }
  reads = 0; searches = 0
  const edit = (path: string, value: string, hash = job.planHash!) => editProfileField({ ...options, hash, change: { path, value } })
  await assert.rejects(edit('profile.education[0].data.end_date', 'wrong'), { code: 'profile_field_invalid' })
  assert.deepEqual([reads, saves, searches], [0, 0, 0])
  const originalEducation = structuredClone(job.plan!.input!.education)
  await edit('profile.headline', 'New headline')
  assert.deepEqual(job.plan!.input!.education, originalEducation)
  assert(job.plan!.issues.some(issue => issue.path.endsWith('end_date')))
  assert.deepEqual([reads, saves, searches], [1, 1, 0])
  await assert.rejects(edit('profile.headline', 'Stale', 'old-hash'), { code: 'profile_plan_hash_mismatch' })
  await edit('profile.education[0].data.end_date', '2021-06')
  assert.equal(job.plan!.input!.education[0].factId, 'edu_1')
  assert(job.plan!.steps.some(step => step.id === 'education-1'))
  assert(!job.plan!.issues.some(issue => issue.path.endsWith('end_date')))
  assert(job.plan!.issues.some(issue => issue.path === 'profile.skills.omitted'))
  assert.deepEqual([reads, saves, searches], [2, 2, 0], 'reuse catalogs; no generation or SKILL searches')
  await edit('profile.education[0].data.end_date', '2021-07')
  assert.equal(job.plan!.fieldEdits!.find(item => item.path.endsWith('end_date'))!.originalValue, '2021')
  const operation = edit('profile.headline', 'First')
  await assert.rejects(edit('profile.headline', 'Concurrent'), { code: 'linkedin_operation_active' })
  await operation
  await edit('profile.headline', 'Before')
  assert(!job.plan!.steps.some(step => step.id === 'headline'), 'equal values need no write')
  assert.equal(job.plan!.snapshot.values.headline, 'Before', 'known values remain visible without a write step')
  job.status = 'verifying'
  await assert.rejects(edit('profile.headline', 'During Apply'), { code: 'profile_job_not_ready' })
  job.status = 'preview_ready'
  const select = (enabled: boolean) => editProfileField({ ...options, hash: job.planHash!,
    change: { path: 'profile.headline', enabled } })
  const hashBefore = job.planHash
  const publicJob = await select(false)
  assert.deepEqual(publicJob.preview!.disabledFields, ['profile.headline'])
  assert.notEqual(job.planHash, hashBefore)
  assert.equal(job.plan!.input!.headline, 'Before')
  assert.equal(job.plan!.fieldEdits!.find(item => item.path === 'profile.headline')!.value, 'Before')
  jobs.clear() // A reload must restore selection from durable state, not a UI cache.
  options.store.get = async () => job as any
  assert.deepEqual((await select(false)).preview!.disabledFields, ['profile.headline'])
  await select(true)
  assert.deepEqual(job.plan!.disabledFields, [])
  current.provider_id = 'another-author'
  await assert.rejects(edit('profile.headline', 'Wrong account'), { code: 'linkedin_provider_id_mismatch' })
  current.provider_id = 'mock'; failSave = true
  await assert.rejects(edit('profile.headline', 'Unsaved'), { code: 'profile_state_persist_failed' })
  assert.equal(job.status, 'failed')
  assert.equal(job.phase, 'field_save_uncertain')
  assert.equal(locked, false)
}
