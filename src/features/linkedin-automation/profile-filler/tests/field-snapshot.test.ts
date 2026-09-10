import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import { editProfileField } from '../edit-field.ts'
import { assertApprovedState } from '../approved-state.ts'
import { prepareStep } from '../prepare-step.ts'
import { planningSnapshot } from '../planning-snapshot.ts'
import { NOOP_PROFILE_LOGGER as logger } from '../profile-logger.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileInput } from '../input-types.ts'

export async function testFieldSnapshot() {
  let reads = 0, searches = 0, saves = 0
  const current = { provider_id: 'mock', description: 'Before', bio: 'About', secret: 'not-for-storage',
    specifics: { education: [], experience: [], skills: [{ name: 'Existing' }], hidden: 'not-for-storage' } }
  const input: ProfileInput = { schemaVersion: 1, headline: 'Engineer', experience: [], education: [],
    skills: { add: Array.from({ length: 100 }, (_, i) => `Skill ${i}`), targetCount: 100 },
    openToWork: { jobTitles: [{ name: 'Engineer' }], locations: [{ name: 'London' }],
      workplaceTypes: ['REMOTE'], employmentTypes: ['FULL_TIME'], visibility: 'RECRUITERS_ONLY' } }
  const client: ProfileClient = { async getAccount() { throw Error('unexpected') },
    async getOwnProfile(_id, _sections, options) { assert.equal(options?.fresh, true); reads++; return structuredClone(current) },
    async searchParameters(_id, type, keywords) { assert.notEqual(type, 'SKILL'); searches++; return [{ id: keywords, name: keywords }] },
    async updateOwnProfile() { throw Error('no writes in Preview') } }
  const plan = await buildProfilePlan(client, { accountId: 'mock', providerId: 'mock',
    platformAccountId: 1, clientName: 'Mock', profileUrl: '' }, input, current, [], logger)
  assert(!JSON.stringify(plan).includes('not-for-storage'), 'snapshot is bounded to planning fields')
  let saved: ProfileJob = { jobId: 'mock', platformAccountId: 1, clientName: 'Mock', plan,
    planHash: 'initial', status: 'preview_ready', phase: 'preview_ready', createdAt: '', updatedAt: '' }
  const jobs = new Map<string, ProfileJob>()
  const options = { jobId: 'mock', jobs, client, logger, acquire: () => () => {}, store: {
    async get() { return JSON.parse(JSON.stringify(saved)) as ProfileJob },
    async update(_id: string, patch: Partial<ProfileJob>) { saves++; saved = JSON.parse(JSON.stringify({ ...saved, ...patch })) }
  } }
  const select = (path: string, enabled: boolean) => editProfileField({ ...options, hash: saved.planHash!, change: { path, enabled } })
  reads = 0; searches = 0
  for (const path of ['profile.headline', 'profile.skills.add', 'profile.open_to_work.employment_types']) {
    await select(path, false)
    jobs.clear() // Every second toggle restores the saved job, not an in-memory profile cache.
    const shown = await select(path, true)
    assert(!JSON.stringify(shown).includes('planning'))
  }
  assert.deepEqual([reads, searches, saves], [0, 0, 6], 'six choices, zero Unipile calls, six durable saves')
  await select('profile.headline', true)
  assert.equal(saves, 6, 'an unchanged choice is not another Noco write')
  assertApprovedState(saved.plan!, current)
  await editProfileField({ ...options, hash: saved.planHash!, change: { path: 'profile.headline', value: 'Edited' } })
  assert.equal(reads, 1, 'value edits still read fresh')
  const step = saved.plan!.steps.find(item => item.section === 'headline')!
  await prepareStep(client, 'mock', step, logger)
  assert.equal(reads, 2, 'prewrite is always fresh, never the planning snapshot')
  current.specifics.skills.push({ name: 'Outside change' })
  assert.throws(() => assertApprovedState(saved.plan!, current), { code: 'profile_preview_stale' })
  jobs.clear(); delete saved.plan!.planning
  await select('profile.headline', false)
  await select('profile.headline', true)
  assert.equal(reads, 3, 'legacy Preview loads the planning snapshot only once')
  const unavailable = planningSnapshot({ provider_id: 'mock', specifics: {
    education: null, throttled_sections: ['linkedin_education'] } }, plan.planning!.profile, ['education'])
  assert.equal((unavailable.specifics as Record<string, unknown>).education, null)
  assert.deepEqual((unavailable.specifics as Record<string, unknown>).throttled_sections, ['education'])
}
