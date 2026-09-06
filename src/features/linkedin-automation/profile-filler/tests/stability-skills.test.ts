import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import { validateProfileFile } from '../validator.ts'
import { executeProfilePlan } from '../executor.ts'
import { finishMutation } from '../mutation-persistence.ts'
import type { ProfileJob } from '../job-types.ts'
import type { JsonObject } from '../input-types.ts'
import { noWait, silent, fixturePlan } from './stability-fixtures.ts'

export async function testSkillCompletion() {
  const current = { description: 'Old', specifics: { experience: [], education: [],
    skills: Array.from({ length: 42 }, (_, i) => ({ name: `Skill ${i}` })) } }
  const desired = validateProfileFile({ profile: { headline: 'New',
    skills: { add: Array.from({ length: 100 }, (_, i) => `Skill ${i}`), target_count: 100 } } })
  const searches: string[] = []
  const client = { async getAccount() { return {} },
    async searchParameters(_id: string, type: string) { searches.push(type); return [] },
    async getOwnProfile() { return structuredClone(current) },
    async updateOwnProfile(_id: string, payload: JsonObject) {
      const value = (payload.specifics as { linkedin: { headline?: string; skills?: { name: string }[] } }).linkedin
      if (value.headline) current.description = value.headline
      for (const item of value.skills ?? []) {
        assert(!current.specifics.skills.some(old => old.name === item.name))
        current.specifics.skills.push(item)
      }
    } }
  const plan = await buildProfilePlan(client, fixturePlan([]).account, desired.value!, current, desired.issues)
  assert.equal(plan.issues.filter(issue => issue.level === 'fatal').length, 0)
  const additions = plan.steps.filter(step => step.section === 'skills' && !step.readOnly)
  assert.equal(additions.reduce((sum, step) => sum + (step.verification.kind === 'skills'
    ? step.verification.expected.length : 0), 0), 58)
  const result = await executeProfilePlan(client, plan, { timing: noWait, wait: async () => undefined })
  assert.equal(result.status, 'verified')
  assert.equal(current.specifics.skills.length, 100)
  assert.equal(searches.includes('SKILL'), false)
  const more = validateProfileFile({ profile: { headline: 'Another', skills: { add: ['New specialty'] } } })
  const partial = await buildProfilePlan(client, plan.account, more.value!, current, more.issues)
  assert(partial.issues.some(issue => issue.path === 'profile.skills.omitted'))
  assert(!partial.issues.some(issue => issue.level === 'fatal'))
  const partialResult = await executeProfilePlan(client, partial, { timing: noWait, wait: async () => undefined })
  const job: ProfileJob = { jobId: 'partial', platformAccountId: 1, clientName: 'Mock', status: 'running',
    phase: '', plan: partial, createdAt: '', updatedAt: '' }
  await finishMutation({ job, store: { async update() {} }, update: patch => Object.assign(job, patch),
    logger: silent }, partialResult)
  assert.equal(job.status, 'needs_expert_review')
  assert.equal(job.phase, 'partially_completed')
  assert.equal(current.specifics.skills.length, 100)
}
