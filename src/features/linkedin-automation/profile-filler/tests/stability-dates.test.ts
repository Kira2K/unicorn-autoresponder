import assert from 'node:assert/strict'
import { validateProfileFile } from '../validator.ts'
import { profileDocument } from '../profile-document.ts'
import { planEducation } from '../planners/education.ts'
import { verifyProfile } from '../verify.ts'
import { experienceCandidates } from '../profile-match.ts'
import { educationCandidates } from '../profile-match.ts'
import { captureApprovedEntries, assertApprovedState } from '../approved-state.ts'
import { fixturePlan } from './stability-fixtures.ts'
import type { ValidationIssue } from '../input-types.ts'

export function testDatePrecision() {
  const input = validateProfileFile({ profile: { education: [{ data: { school: 'University',
    degree: 'Master', field_of_study: 'Computer Science', end_date: '2021', description: 'New', skills: [] } }] } })
  assert.deepEqual(input.value!.education[0].data.endDate, { year: 2021 })
  assert(JSON.stringify(profileDocument(input.value!)).includes('"end_date":"2021"'))
  const current = { specifics: { education: [
    { id: 'bachelor', school: 'University', degree: 'Bachelor', field_of_study: 'Computer Science',
      ended_on: { year: 2019, month: 6 }, description: 'Old', skills: [] },
    { id: 'master', school: 'University', degree: 'Master', field_of_study: 'Computer Science',
      ended_on: { year: 2021, month: 6 }, description: 'Old', skills: [] }
  ] } }
  const issues: ValidationIssue[] = []
  const steps = planEducation(input.value!, current, issues)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].verification.kind === 'education' && steps[0].verification.id, 'master')
  assert(!JSON.stringify(steps[0].payload).includes('end_date'))
  current.specifics.education[1].description = 'New'
  assert.equal(verifyProfile(current, steps[0].verification), true)
  assert.equal(educationCandidates([current.specifics.education[0]], input.value!.education[0]).length, 0,
    'A Bachelor must not be overwritten with a different Master degree')
  const approved = fixturePlan(steps)
  approved.entryPolicy = captureApprovedEntries(input.value!, current)
  assert.doesNotThrow(() => assertApprovedState(approved, current))
  const changed = structuredClone(current)
  changed.specifics.education.pop()
  assert.throws(() => assertApprovedState(approved, changed), /new Preview/)
  assert.throws(() => assertApprovedState(approved, { specifics: {} }), /unavailable/)
  approved.skillPolicy = { baseline: ['Existing'], target: ['Existing', 'New'] }
  assert.throws(() => assertApprovedState(approved, { specifics: {
    ...current.specifics, skills: [{ name: 'New' }]
  } }), /new Preview/)
  const missing: ValidationIssue[] = []
  assert.equal(planEducation(input.value!, { specifics: { education: [] } }, missing).length, 0)
  assert(missing.some(issue => issue.level === 'fatal'))
  assert.equal(experienceCandidates([{ id: 'existing', company: 'Acme', job_title: 'DevOps Engineer',
    started_on: '2019-04' }], { match: { company: 'Acme', jobTitle: 'Engineer',
    startDate: { year: 2019, month: 4 } }, data: { company: 'Acme', jobTitle: 'Engineer', skills: [] } }).length, 1)
}
