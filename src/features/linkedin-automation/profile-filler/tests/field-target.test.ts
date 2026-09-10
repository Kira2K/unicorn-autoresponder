import assert from 'node:assert/strict'
import { buildProfilePlan } from '../planner.ts'
import { rebuildFieldPlan } from '../field-plan.ts'
import { changeProfileField } from '../field-change.ts'
import { NOOP_PROFILE_LOGGER as logger } from '../profile-logger.ts'
import { assertApprovedState } from '../approved-state.ts'
import { assertDistinctPlanTargets } from '../entry-claims.ts'
import { prepareStep } from '../prepare-step.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileInput } from '../input-types.ts'

export async function testFieldTarget() {
  const startDate = { year: 2017, month: 9 }
  const input: ProfileInput = { schemaVersion: 1, skills: { add: [], targetCount: 100 }, experience: [],
    education: [{ factId: 'edu_1', match: { school: 'University', startDate }, data: {
      school: 'University', degree: 'MSc', startDate, description: 'MSc text', skills: [] } }] }
  const current = { provider_id: 'mock', specifics: { experience: [], skills: [], education: [
    { id: 'bsc', school: 'University', degree: 'BSc', start_date: startDate, description: 'BSc text' },
    { id: 'msc', school: 'University', degree: 'MSc', start_date: startDate, description: 'MSc text' }
  ] } }
  const client: ProfileClient = { async getAccount() { throw Error('unexpected') },
    async getOwnProfile() { return structuredClone(current) }, async searchParameters() { return [] },
    async updateOwnProfile() { throw Error('no writes in Preview') } }
  const original = structuredClone(input)
  const plan = await buildProfilePlan(client, { accountId: 'mock', providerId: 'mock',
    platformAccountId: 1, clientName: 'Mock', profileUrl: '' }, input, current, [], logger)
  assert.deepEqual(input, original, 'planning does not mutate CV input')
  assert(!plan.steps.some(step => step.section === 'education'), 'unchanged entry still needs stable identity')
  const legacy = JSON.parse(JSON.stringify(plan)) as typeof plan
  delete legacy.planning
  delete legacy.input!.education[0].match.linkedInId
  const path = 'profile.education[0].data.degree'
  const legacyEdit = changeProfileField(legacy.input!, { path, value: 'BSc' })
  const legacyRebuilt = await rebuildFieldPlan(client, legacy, legacyEdit.input, 'education', logger, path)
  const legacySpec = legacyRebuilt.steps.find(item => item.id === 'education-1')!.verification
  assert('id' in legacySpec && legacySpec.id === 'msc', 'old Preview binds the original degree before editing')
  const changed = changeProfileField(plan.input!, { path, value: 'BSc' })
  const rebuilt = await rebuildFieldPlan(client, JSON.parse(JSON.stringify(plan)), changed.input, 'education', logger, path)
  const step = rebuilt.steps.find(item => item.id === 'education-1')!
  assert(step)
  assert('id' in step.verification)
  assert.equal(step.verification.id, 'msc', 'editing degree cannot retarget another degree')
  assertApprovedState(rebuilt, current)
  assertDistinctPlanTargets(rebuilt)
  const prepared = await prepareStep(client, 'mock', step, logger)
  assert.equal(prepared.mode, 'write')
  assert.deepEqual(prepared.step.payload, step.payload)
  const off = await rebuildFieldPlan(client, rebuilt, rebuilt.input!, 'education', logger, '', [path])
  const on = await rebuildFieldPlan(client, off, off.input!, 'education', logger, '', [])
  assert.equal(on.input!.education[0].match.linkedInId, 'msc', 'checkboxes preserve the bound target')
  current.specifics.education.pop()
  const missing = await rebuildFieldPlan(client, rebuilt, rebuilt.input!, 'education', logger, path)
  assert(!missing.steps.some(item => item.section === 'education'), 'missing target cannot become a create')
  assert(missing.issues.some(issue => issue.level === 'fatal' && issue.path.startsWith('profile.education')))
}
