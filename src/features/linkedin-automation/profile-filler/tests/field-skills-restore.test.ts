import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import { rebuildFieldPlan } from '../field-plan.ts'
import { finishMutation } from '../mutation-persistence.ts'
import { NOOP_PROFILE_LOGGER as logger } from '../profile-logger.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileInput } from '../input-types.ts'

export async function testFieldSkillsRestore() {
  const input: ProfileInput = { schemaVersion: 1, headline: 'Engineer', education: [],
    skills: { add: ['Go', ...Array.from({ length: 99 }, (_, i) => `Skill ${i}`)], targetCount: 100 },
    experience: [{ match: { company: 'Company', jobTitle: 'Engineer' }, data: {
      company: 'Company', jobTitle: 'Engineer', startDate: { year: 2020, month: 1 }, skills: ['Go'] } }] }
  const current = { provider_id: 'mock', specifics: { experience: [], education: [], skills: [] as Array<{ name: string }> } }
  const client: ProfileClient = { async getAccount() { throw Error('unexpected') },
    async getOwnProfile() { return structuredClone(current) }, async searchParameters() { return [] },
    async updateOwnProfile() { throw Error('no writes in Preview') } }
  const account = { accountId: 'mock', providerId: 'mock', platformAccountId: 1, clientName: 'Mock', profileUrl: '' }
  const plan = await buildProfilePlan(client, account, input, current, [], logger)
  const off = await rebuildFieldPlan(client, plan, plan.input!, 'skills', logger, '', ['profile.skills.add'])
  assert(off.issues.some(issue => issue.path === 'profile.skills.omitted'))
  const on = await rebuildFieldPlan(client, JSON.parse(JSON.stringify(off)), off.input!, 'skills', logger, '', [])
  assert.equal(on.skillPolicy?.target.length, 100)
  assert(!on.issues.some(issue => issue.path === 'profile.skills.omitted'), 'restored skills are not omissions')
  const job: ProfileJob = { jobId: 'mock', platformAccountId: 1, clientName: 'Mock', plan: on,
    status: 'running', phase: 'verifying', createdAt: '', updatedAt: '' }
  await finishMutation({ job, logger, store: { async update() {} }, update: patch => Object.assign(job, patch) },
    { status: 'verified', steps: on.steps.map(step => ({ stepId: step.id, section: step.section,
      status: 'verified', message: 'confirmed' })) })
  assert.equal(job.status, 'succeeded')
  assert.equal(job.phase, 'completed_verified')
  current.specifics.skills = Array.from({ length: 100 }, (_, i) => ({ name: `Existing ${i}` }))
  const full = await buildProfilePlan(client, account, input, current, [], logger)
  const stillFull = await rebuildFieldPlan(client, full, full.input!, 'skills', logger, '', [])
  assert(stillFull.issues.some(issue => issue.path === 'profile.skills.omitted' && issue.suggestions?.includes('Go')),
    'real capacity omissions remain after the candidates have been pruned')
}
