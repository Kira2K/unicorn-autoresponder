import assert from 'node:assert/strict'
import { mergeRepair } from '../generation/repair-schema.ts'
import { materializeGeneratedProfile, generatedContractIssues } from '../generation/materialize-profile.ts'
import { validateWithRepair } from '../generation/validate-with-repair.ts'
import { facts, raw } from './fact-coverage-fixture.ts'

export async function testRepairEntryContract() {
  const allowed = { experience: facts.experience.map(item => item.fact_id!) }
  const merge = (replacement: unknown[]) => materializeGeneratedProfile(mergeRepair(raw(),
    { profile: { experience: replacement } }, ['experience'], allowed), facts)
  const addition = raw().profile.experience[0]
  const duplicate = merge([addition, { ...addition, description: 'Conflicting repair.' }])
  assert(generatedContractIssues(duplicate).some(issue => issue.message.includes('Duplicate')))
  assert(generatedContractIssues(merge([{ ...addition, fact_id: 'exp_99' }]))
    .some(issue => issue.message.includes('Unknown')))
  assert(generatedContractIssues(merge([null])).some(issue => issue.message.includes('missing')))
  const missing = materializeGeneratedProfile(raw(['exp_1', 'exp_2']), facts)
  let attempts = 0
  await assert.rejects(() => validateWithRepair({ generated: missing, facts, country: 'Poland',
    logger: { event() {} }, generator: { async repairProfile() {
      attempts += 1
      return duplicate
    } } }), { code: 'profile_generation_validation_failed' })
  assert.equal(attempts, 2)
  attempts = 0
  const repaired = await validateWithRepair({ generated: duplicate, facts, country: 'Poland',
    logger: { event() {} }, generator: { async repairProfile() {
      attempts += 1
      return materializeGeneratedProfile(mergeRepair(raw(['exp_1', 'exp_1', 'exp_2', 'exp_3']),
        { profile: { experience: [addition] } }, ['experience'], allowed), facts)
    } } })
  assert.equal(attempts, 1)
  assert.equal(repaired.issues.filter(issue => issue.level === 'fatal').length, 0)
  assert.equal(repaired.value.experience.length, 3)
  const untouched = mergeRepair(raw(), { profile: { experience: [addition] } }, ['experience'], allowed)
  assert.deepEqual((untouched.profile as { experience: typeof addition[] }).experience
    .filter(item => item.fact_id !== 'exp_1'), raw().profile.experience.slice(1))
}
