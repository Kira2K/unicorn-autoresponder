import assert from 'node:assert/strict'
import { readyChanges, hasBlockingIssues } from '../partial-plan.ts'
import { fixturePlan, headlineStep, createStep } from './stability-fixtures.ts'
import { finishMutation } from '../mutation-persistence.ts'
import type { ProfileJob } from '../job-types.ts'
import type { ValidationIssue } from '../input-types.ts'
import type { PlanStep } from '../plan-types.ts'

export async function testPartialPlan() {
  const issue: ValidationIssue = { level: 'fatal', path: 'profile.education[0].data.end_date',
    message: 'Unipile requires a month to write end_date; the CV does not supply it.' }
  const education: PlanStep = { ...createStep, section: 'education', id: 'education-1' }
  const selected = readyChanges([headlineStep, education], [issue])
  assert.deepEqual(selected.skippedChanges, ['profile.education[0]'])
  assert.deepEqual(selected.steps, [headlineStep])
  const plan = { ...fixturePlan(selected.steps), ...selected, issues: [issue] }
  assert.equal(hasBlockingIssues(plan), false)
  assert.equal(hasBlockingIssues({ ...plan, skippedChanges: undefined }), true, 'legacy Preview needs regeneration')
  assert.equal(hasBlockingIssues({ ...plan, steps: [] }), true)
  assert.equal(hasBlockingIssues({ ...plan, steps: [education] }), true)
  assert.equal(hasBlockingIssues({ ...plan, issues: [...plan.issues,
    { level: 'fatal', path: 'identity', message: 'Mismatch' }] }), true, 'global safety still blocks everything')
  const records = readyChanges([education, { ...education, id: 'education-11' }], [issue])
  assert.deepEqual(records.steps.map(step => step.id), ['education-11'], 'record 1 does not hide record 11')
  const withSkills: PlanStep = { ...createStep, verification: { kind: 'experience',
    expected: { company: 'Example', jobTitle: 'Engineer', skills: ['SQL'] } } }
  assert.deepEqual(readyChanges([headlineStep, withSkills], [{ level: 'fatal',
    path: 'profile.skills', message: 'Unavailable' }]).steps, [headlineStep])
  const job: ProfileJob = { jobId: 'partial', platformAccountId: 7, clientName: 'Mock', plan,
    status: 'running', phase: 'verifying', createdAt: '', updatedAt: '' }
  let saves = 0
  await finishMutation({ job, update: patch => Object.assign(job, patch), logger: { event() {} },
    store: { async update() { saves += 1 } } }, { status: 'verified', startedAt: '', updatedAt: '',
    steps: [{ stepId: 'headline', section: 'headline', status: 'verified', message: 'Verified' }] })
  assert.equal(saves, 1)
  assert.equal(job.status, 'needs_expert_review')
  assert.equal(job.phase, 'partially_completed')
}
