import assert from 'node:assert/strict'
import { executeProfilePlan, resumeProfileVerification } from '../executor.ts'
import { prepareStep } from '../prepare-step.ts'
import type { ProfileClient, FillResult } from '../plan-types.ts'
import { noWait, silent, fixtureProfile, fixturePlan, createStep, headlineStep } from './stability-fixtures.ts'

export async function testSafeWrites() {
  let writes = 0
  const client: ProfileClient = { async getAccount() { return {} }, async searchParameters() { return [] },
    async getOwnProfile(_id, _sections, options) { assert.equal(options?.fresh, true); return fixtureProfile() },
    async updateOwnProfile() { writes += 1; throw Object.assign(new Error('timeout'), { code: 'unipile_timeout' }) } }
  const plan = fixturePlan([createStep, headlineStep])
  const result = await executeProfilePlan(client, plan, { timing: noWait, wait: async () => undefined })
  assert.equal(writes, 1)
  assert.equal(result.steps[0].failureKind, 'write_uncertain')
  assert.equal(result.steps[1].status, 'pending')
  assert(result.steps[0].writeIntent)
  writes = 0
  await assert.rejects(() => executeProfilePlan(client, plan, { timing: noWait,
    wait: async () => undefined, onProgress(state) {
      if (state.steps[0].writeIntent) throw new Error('mock Noco persist failed')
    } }), /persist failed/)
  assert.equal(writes, 0)
  await assert.rejects(() => prepareStep({ ...client, async getOwnProfile() {
    return { specifics: { throttled_sections: ['experience'], skills: [] } }
  } }, 'mock', createStep, silent), { code: 'profile_section_unavailable' })
  const saved: FillResult = { status: 'running', steps: [{ stepId: createStep.id,
    section: 'experience', status: 'writing', message: 'Intent',
    writeIntent: { step: createStep, savedAt: new Date(0).toISOString() } },
    { stepId: 'headline', section: 'headline', status: 'pending', message: 'Not attempted' }] }
  await resumeProfileVerification(client, plan, saved, { timing: noWait, wait: async () => undefined })
  assert.equal(writes, 0)
  let readAt = 0
  let clock = 0
  await executeProfilePlan({ ...client, async updateOwnProfile() {
    throw Object.assign(new Error('429'), { code: 'unipile_http_429', details: { httpStatus: 429, retryAfterMs: 900000 } })
  }, async getOwnProfile() { readAt = clock; return fixtureProfile() } }, fixturePlan([headlineStep]),
  { timing: noWait, wait: async delay => { clock += delay }, clock: () => clock })
  assert(readAt >= 900000)
  writes = 0
  const visible = fixtureProfile()
  const resolved = await executeProfilePlan({ ...client,
    async getOwnProfile() { return visible }, async updateOwnProfile() {
      writes += 1; visible.description = 'New'
      throw Object.assign(new Error('lost response'), { code: 'unipile_timeout' })
    } }, fixturePlan([headlineStep, { ...headlineStep, id: 'about', section: 'about',
      verification: { kind: 'about', expected: 'New' } }]),
  { timing: noWait, wait: async () => undefined })
  assert.equal(writes, 1, 'A resolved timeout still requires approval before later writes')
  assert.equal(resolved.steps[0].status, 'verified')
  assert.equal(resolved.steps[1].status, 'pending')
}
