import assert from 'node:assert/strict'
import { runMutation } from '../mutation-run.ts'
import type { ProfileJob } from '../job-types.ts'
import { publicProfileJob } from '../job-types.ts'
import { noWait, silent, fixturePlan, headlineStep } from './stability-fixtures.ts'
import { recoverInterruptedJob } from '../job-state.ts'

export async function testPersistedRecovery() {
  const plan = fixturePlan([headlineStep, { ...headlineStep, id: 'about', section: 'about',
    payload: { bio: 'New' }, verification: { kind: 'about', expected: 'New' } }])
  for (const failure of ['writing', 'verifying', 'terminal']) {
    let writes = 0
    let failedOnce = false
    const profile = { description: 'Old', bio: 'Old' }
    const job: ProfileJob = { jobId: 'job', platformAccountId: 1, clientName: 'Mock',
      status: 'running', phase: '', createdAt: '', updatedAt: '', plan }
    let saved = structuredClone(job)
    const store = { async update(_id: string, patch: Partial<ProfileJob>) {
      const step = patch.result?.steps[0]
      if (!failedOnce && (failure === 'terminal' ? patch.status === 'succeeded'
        : step?.writeIntent && step.status === failure)) {
        failedOnce = true; throw new Error('mock Noco outage')
      }
      saved = { ...saved, ...structuredClone(patch) }
    } }
    await new Promise<void>(resolve => runMutation({ job, store, update: patch => Object.assign(job, patch),
      release() {}, client: { async getAccount() { return {} }, async searchParameters() { return [] },
        async getOwnProfile() { return profile }, async updateOwnProfile(_id, payload) {
          writes += 1
          if (payload.bio) profile.bio = 'New'
          else profile.description = 'New'
        } }, executorOptions: { timing: noWait, logger: silent, wait: async () => undefined, onSettled: resolve } }))
    assert.equal(failedOnce, true, 'the intended persistence boundary must be exercised')
    assert.equal(writes, failure === 'writing' ? 0 : failure === 'verifying' ? 1 : 2)
    assert.equal(job.status, 'needs_expert_review')
    assert.equal(saved.status, job.status)
    assert.equal(JSON.stringify(publicProfileJob(job).result).includes('writeIntent'), false)
    if (failure === 'verifying') {
      const restart: ProfileJob = { ...saved, status: 'running', result: { status: 'running', steps: [{
        stepId: 'headline', section: 'headline', status: 'writing', message: '',
        writeIntent: { step: headlineStep, savedAt: new Date().toISOString() }
      }] } }
      await recoverInterruptedJob(store, restart)
      assert.equal(restart.status, 'verifying')
    }
  }
}

export async function testRetryAfterPersistFailure() {
  let clock = 0, writes = 0, failed = false
  const readTimes: number[] = []
  const job: ProfileJob = { jobId: 'cooldown', platformAccountId: 1, clientName: 'Mock',
    status: 'running', phase: '', createdAt: '', updatedAt: '',
    plan: fixturePlan([headlineStep, { ...headlineStep, id: 'about', section: 'about',
      payload: { bio: 'New' }, verification: { kind: 'about', expected: 'New' } }]) }
  await new Promise<void>(resolve => runMutation({ job, update: patch => Object.assign(job, patch), release() {},
    store: { async update(_id, patch) {
      if (!failed && patch.result?.steps[0].status === 'verifying') {
        failed = true
        throw new Error('Noco failed after PATCH')
      }
    } }, client: {
      async getAccount() { return {} }, async searchParameters() { return [] },
      async getOwnProfile() {
        if (writes) readTimes.push(clock)
        return { description: writes ? 'New' : 'Old', bio: 'Old' }
      },
      async updateOwnProfile() {
        writes += 1
        throw Object.assign(new Error('provider cooldown'), {
          code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 120_000 }
        })
      }
    }, executorOptions: { timing: noWait, logger: silent, clock: () => clock,
      wait: async ms => { clock += ms }, onSettled: resolve } }))
  assert.equal(failed, true)
  assert.equal(writes, 1, 'failed persistence never permits the next PATCH')
  assert.ok(readTimes.length > 0)
  assert.ok(readTimes.every(at => at >= 120_000), 'Noco outage must not discard provider cooldown')
  assert.equal(job.status, 'needs_expert_review')
}
