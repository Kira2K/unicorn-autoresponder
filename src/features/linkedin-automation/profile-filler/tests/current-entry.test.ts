import assert from 'node:assert/strict'
import { facts, raw } from './fact-coverage-fixture.ts'
import { materializeGeneratedProfile } from '../generation/materialize-profile.ts'
import { validateGeneratedProfile } from '../generation/validate-generated.ts'
import { assertCvFacts } from '../generation/facts-validation.ts'
import { profileDocument } from '../profile-document.ts'
import { validateProfileFile } from '../validator.ts'
import { planExperience } from '../planners/experience.ts'
import { prepareStep } from '../prepare-step.ts'
import { verifyProfile } from '../verify.ts'
import { silent } from './stability-fixtures.ts'
import type { ValidationIssue } from '../input-types.ts'

export async function testCurrentEntry() {
  const source = structuredClone(facts)
  source.experience[0].end_date = 'present'
  source.education[0].end_date = 'present'
  const extracted = structuredClone(source)
  extracted.experience.forEach(item => delete item.fact_id)
  extracted.education.forEach(item => delete item.fact_id)
  assert.doesNotThrow(() => assertCvFacts(extracted))
  const generated = materializeGeneratedProfile(raw(), source)
  const validated = validateGeneratedProfile(generated, source, 'Poland')
  assert.equal(validated.issues.filter(issue => issue.level === 'fatal').length, 0)
  assert.equal(validated.value.experience[0].data.isCurrent, true)
  assert.equal(validated.value.education[0].data.isCurrent, true)
  const desired = validated.value.experience[0]
  const roundTrip = validateProfileFile(profileDocument(validated.value)).value!
  assert.equal(roundTrip.experience[0].data.isCurrent, true)
  const unknown = validateGeneratedProfile(materializeGeneratedProfile(raw(), facts), facts, 'Poland')
  assert.equal(unknown.value.experience[0].data.isCurrent, undefined)
  const current = { specifics: { skills: [], experience: [{ id: 'existing',
    company: desired.data.company, job_title: desired.data.jobTitle, start_date: '2020-01',
    end_date: '2025-01', description: desired.data.description, skills: desired.data.skills }] } }
  const issues: ValidationIssue[] = []
  assert.deepEqual(planExperience({ ...validated.value, experience: [desired] }, current, issues), [])
  assert(issues.some(issue => issue.level === 'fatal' && issue.path.endsWith('end_date')))
  const spec = { kind: 'experience' as const, id: 'existing', expected: desired.data }
  assert.equal(verifyProfile(current, spec), false)
  const createIssues: ValidationIssue[] = []
  const steps = planExperience({ ...validated.value, experience: [desired] },
    { specifics: { experience: [] } }, createIssues)
  assert.equal(steps.length, 1)
  assert(!JSON.stringify(steps[0].payload).includes('present'))
  const step = { ...steps[0], action: 'update' as const, verification: spec }
  await assert.rejects(() => prepareStep({ async getOwnProfile() { return current },
    async getAccount() { return {} }, async searchParameters() { return [] },
    async updateOwnProfile() { assert.fail('No PATCH is allowed') }
  }, 'mock', step, silent), { code: 'profile_current_status_unsupported' })
  const unchanged = structuredClone(current)
  Object.assign(unchanged.specifics.experience[0], { end_date: undefined, location: desired.data.location,
    workplace_type: desired.data.workplaceType })
  assert.equal(verifyProfile(unchanged, spec), true)
}
