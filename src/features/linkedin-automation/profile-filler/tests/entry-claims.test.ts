import assert from 'node:assert/strict'
import { planEducation } from '../planners/education.ts'
import { planExperience } from '../planners/experience.ts'
import { validateProfileFile } from '../validator.ts'
import { executeProfilePlan } from '../executor.ts'
import { assertDistinctPlanTargets } from '../entry-claims.ts'
import { fixturePlan, noWait } from './stability-fixtures.ts'
import type { PlanStep } from '../plan-types.ts'
import type { ValidationIssue } from '../input-types.ts'

export async function testEntryClaims() {
  const desired = validateProfileFile({ profile: { education: ['Bachelor', 'Master'].map(degree => ({
    data: { school: 'University', degree, description: 'Same', skills: [] }
  })) } }).value!
  const current = { specifics: { education: [{ id: 'shared', school: 'University',
    description: 'Same', skills: [] }] } }
  const issues: ValidationIssue[] = []
  assert.deepEqual(planEducation(desired, current, issues), [])
  assert.equal(issues.filter(issue => issue.level === 'fatal').length, 2)
  const distinct = { specifics: { education: ['Bachelor', 'Master'].map(degree => ({
    id: degree, school: 'University', degree, description: 'Old', skills: []
  })) } }
  const validIssues: ValidationIssue[] = []
  const steps = planEducation(desired, distinct, validIssues)
  assert.equal(steps.length, 2)
  assert.equal(validIssues.length, 0)
  assert.doesNotThrow(() => assertDistinctPlanTargets(fixturePlan(steps)))
  const oldSteps = steps.map(step => ({ ...step, verification: { ...step.verification,
    id: 'shared' } })) as PlanStep[]
  let writes = 0
  let reads = 0
  await assert.rejects(() => executeProfilePlan({
    async getAccount() { return {} }, async searchParameters() { return [] },
    async getOwnProfile() { reads += 1; return current },
    async updateOwnProfile() { writes += 1 }
  }, fixturePlan(oldSteps), { timing: noWait }), { code: 'profile_entry_ambiguous' })
  assert.equal(writes, 0)
  assert.equal(reads, 0, 'Reject an old conflicting Preview before any provider call')
  const unchanged = fixturePlan([steps[1]])
  unchanged.input = desired
  unchanged.entryPolicy = { education: current.specifics.education }
  assert.throws(() => assertDistinctPlanTargets(unchanged), { code: 'profile_entry_ambiguous' })
  const jobs = validateProfileFile({ profile: { experience: [1, 2].map(() => ({ data: {
    company: 'Acme', job_title: 'Engineer', description: 'New', skills: []
  } })) } }).value!
  const jobIssues: ValidationIssue[] = []
  assert.deepEqual(planExperience(jobs, { specifics: { experience: [{ id: 'same',
    company: 'Acme', job_title: 'Engineer', description: 'Old', skills: [] }] } }, jobIssues), [])
  assert.equal(jobIssues.filter(issue => issue.level === 'fatal').length, 2)
}
