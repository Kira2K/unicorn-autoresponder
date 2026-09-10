import assert from 'node:assert/strict'
import { editProfileField } from '../edit-field.ts'
import { buildProfilePlan } from '../planner.ts'
import { validateProfileFile } from '../validator.ts'
import { fieldDisabled, selectField } from '../field-selection.ts'
import { NOOP_PROFILE_LOGGER } from '../profile-logger.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileInput } from '../input-types.ts'

export async function testV2BlockSelection() {
  let reads = 0, saves = 0, identity = 'owner'
  const failures: string[] = []
  const profile = { id: 'owner', specifics: { experience: [], education: [], skills: [] } }
  const client: ProfileClient = {
    async getOwnProfile(_id, _sections, options) {
      assert.equal(options?.fresh, true); reads++; return { ...structuredClone(profile), id: identity }
    },
    async getAccount() { throw Error('unexpected account read') },
    async searchParameters(_id, type) { assert.notEqual(type, 'SKILL'); return [] },
    async updateOwnProfile() { throw Error('Preview must not write LinkedIn') }
  }
  const input = validateProfileFile({ profile: { headline: 'Engineer', education: [{ data: {
    school: 'University', degree: 'BSc', start_date: '2017-09', end_date: '2021' } }] } }).value!
  const all: ProfileInput = { ...input, openToWork: { jobTitles: [{ name: 'Engineer' }], locations: [{ name: 'London' }],
    workplaceTypes: ['REMOTE'], employmentTypes: ['FULL_TIME'], visibility: 'ALL' } }
  for (const section of ['headline', 'about', 'experience', 'education', 'skills', 'open_to_work']) {
    const path = `profile.${section}`
    const off = selectField(all, [], path, false)
    assert(fieldDisabled(off.disabled, path))
    assert.deepEqual(selectField(all, off.disabled, path, true).disabled, [])
    assert(!fieldDisabled(off.disabled, 'profile.unrelated'), 'section selection is isolated')
  }
  assert.deepEqual(selectField(all, ['profile.education[0].data.grade'], 'profile.education', true).disabled,
    [], 'enable a whole section also clears legacy per-field exclusions')
  assert.throws(() => selectField(all, [], 'profile.unknown', false), { code: 'profile_field_invalid' })
  const plan = await buildProfilePlan(client, { accountId: 'account', providerId: 'owner',
    platformAccountId: 1, clientName: 'Mock', profileUrl: '' }, input, profile, [])
  assert.equal(plan.planning?.profile.id, 'owner', 'retain V2 identity for checkbox-only planning')
  const job: ProfileJob = { jobId: 'v2-blocks', platformAccountId: 1, clientName: 'Mock',
    status: 'preview_ready', phase: 'preview_ready', plan, planHash: 'first', createdAt: '', updatedAt: '' }
  const jobs = new Map([[job.jobId, job]])
  const change = (value: import('../field-change.ts').FieldChange) => editProfileField({
    jobId: job.jobId, hash: job.planHash!, change: value, jobs, client,
    store: { async get() { return job }, async update() { saves++ } }, acquire: () => () => {},
    logger: { ...NOOP_PROFILE_LOGGER, event(stage, status, details) {
      if (stage === 'field_edit' && status === 'failed') failures.push(details?.errorCode ?? '')
    } }
  })
  await change({ path: 'profile.education', enabled: false })
  assert.equal(reads, 0); assert.equal(saves, 1, 'one save disables the whole section')
  assert(!job.plan!.steps.some(step => step.section === 'education'))
  assert(fieldDisabled(job.plan!.disabledFields!, 'profile.education[0].data.end_date'))
  assert.equal(job.plan!.input!.education.length, 1, 'source records are never deleted')
  await change({ path: 'profile.education', enabled: false })
  assert.equal(saves, 1, 'same selection is a no-op')
  await change({ path: 'profile.education', enabled: true })
  assert(!fieldDisabled(job.plan!.disabledFields!, 'profile.education[0].data.end_date'))
  assert.equal(reads, 0)
  await change({ path: 'profile.education[0].data.end_date', value: '2021-06' })
  assert.equal(reads, 1)
  assert(job.plan!.steps.some(step => step.section === 'education'))
  delete job.plan!.planning!.profile.id // old snapshots discarded the V2 ID
  await change({ path: 'profile.education', enabled: false })
  assert.equal(reads, 2, 'repair an old identity-less snapshot with one fresh read')
  assert.equal(job.plan!.planning!.profile.id, 'owner')
  identity = 'different-owner'
  const before = saves
  await assert.rejects(change({ path: 'profile.headline', value: 'Changed' }), { code: 'linkedin_provider_id_mismatch' })
  assert.equal(saves, before)
  assert.deepEqual(failures, ['linkedin_provider_id_mismatch'])
  job.plan!.planning!.profile.id = 'different-owner'
  await assert.rejects(change({ path: 'profile.education', enabled: true }), { code: 'linkedin_provider_id_mismatch' })
  assert.equal(saves, before, 'checkboxes must not bypass cached identity mismatch either')
}
