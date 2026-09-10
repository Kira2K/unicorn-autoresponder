import assert from 'node:assert/strict'
import { materializeGeneratedProfile } from '../generation/materialize-profile.ts'
import { validateGeneratedProfile } from '../generation/validate-generated.ts'
import { validateWithRepair } from '../generation/validate-with-repair.ts'
import { skillNames, facts, raw } from './fact-coverage-fixture.ts'


async function run() {
  const complete: any = materializeGeneratedProfile(raw(), facts)
  assert.equal(complete.profile.experience.length, 3)
  assert.deepEqual(complete.profile.experience[0].data, {
    company: 'Company 1', job_title: 'Engineer 1', location: 'London',
    workplace_type: 'REMOTE', start_date: '2020-01', end_date: undefined,
    description: 'Description for exp_1.', skills: skillNames.slice(0, 5)
  })
  assert.equal(complete.profile.education[0].data.grade, 'A')
  assert.equal(complete.profile.education[0].data.activities, 'Engineering Club')
  assert.equal(validateGeneratedProfile(complete, facts, 'Poland').issues
    .some(issue => issue.level === 'fatal'), false)

  const detachedSkills = raw()
  detachedSkills.profile.experience.forEach((entry, index) => {
    entry.skills = [...skillNames.slice(0, 4), `Experience Specialty ${index + 1}`]
  })
  detachedSkills.profile.education[0].skills = [...skillNames.slice(0, 4), 'Education Specialty']
  const reconciled: any = materializeGeneratedProfile(detachedSkills, facts)
  assert.equal(reconciled.profile.skills.add.length, 100)
  assert.equal(new Set(reconciled.profile.skills.add.map((value: string) => value.toLowerCase())).size, 100)
  for (const entry of [...reconciled.profile.experience, ...reconciled.profile.education]) {
    assert(entry.data.skills.every((skill: string) => reconciled.profile.skills.add.includes(skill)))
  }
  assert.equal(validateGeneratedProfile(reconciled, facts, 'Poland').issues
    .some(issue => issue.level === 'fatal'), false)

  const factsWithoutStartDates = structuredClone(facts)
  const yearFacts = structuredClone(facts)
  yearFacts.education[0].end_date = '2020'
  const yearDocument: any = materializeGeneratedProfile(raw(), yearFacts)
  assert.equal(yearDocument.profile.education[0].data.end_date, '2020')
  const yearValidation = validateGeneratedProfile(yearDocument, yearFacts, 'Poland')
  assert.equal(yearValidation.issues.some(issue => issue.level === 'fatal'), false)
  factsWithoutStartDates.experience[0].start_date = null
  factsWithoutStartDates.education[0].start_date = null
  const withoutStartDates = materializeGeneratedProfile(raw(), factsWithoutStartDates)
  assert.equal(validateGeneratedProfile(withoutStartDates, factsWithoutStartDates, 'Poland').issues
    .some(issue => issue.path.endsWith('.start_date') && issue.level === 'fatal'), false)

  const missing: any = materializeGeneratedProfile(raw(['exp_1', 'exp_2']), facts)
  const missingIssues = validateGeneratedProfile(missing, facts, 'Poland').issues
  assert(missingIssues.some(issue => issue.message.includes('exp_3')))
  let repairs = 0
  const repaired = await validateWithRepair({ generated: missing, facts, country: 'Poland',
    logger: { event() {} }, generator: { async repairProfile(_current: unknown, _facts: unknown,
      _country: string, issues: any[]) {
      repairs += 1
      assert(issues.some(issue => issue.message.includes('exp_3')))
      return materializeGeneratedProfile(raw(), facts)
    } } })
  assert.equal(repairs, 1)
  assert.equal(repaired.value.experience.length, 3)

  const invalid = materializeGeneratedProfile(raw(['exp_1', 'exp_1', 'exp_99']), facts)
  const invalidIssues = validateGeneratedProfile(invalid, facts, 'Poland').issues
  assert(invalidIssues.some(issue => issue.message.includes('Duplicate CV fact ID')))
  assert(invalidIssues.some(issue => issue.message.includes('Unknown CV fact ID')))

  for (const extra of ['exp_1', 'exp_99']) {
    const unresolved = materializeGeneratedProfile(raw(['exp_1', 'exp_2', 'exp_3', extra]), facts)
    let attempts = 0
    await assert.rejects(() => validateWithRepair({ generated: unresolved, facts, country: 'Poland',
      logger: { event() {} }, generator: { async repairProfile() { attempts += 1; return unresolved } } }),
    (error: { code?: string }) => error.code === 'profile_generation_validation_failed')
    assert.equal(attempts, 2, 'Metric fallback must not erase invalid fact IDs')
  }

  await assert.rejects(() => validateWithRepair({ generated: missing, facts, country: 'Poland',
    logger: { event() {} }, generator: { async repairProfile() { return missing } } }),
  (error: any) => error.code === 'profile_generation_validation_failed')
}

run().then(() => console.log('profile generation fact coverage tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
