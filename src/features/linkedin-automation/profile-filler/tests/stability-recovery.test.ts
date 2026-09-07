import assert from 'node:assert/strict'
import { runMutation } from '../mutation-run.ts'
import type { ProfileJob } from '../job-types.ts'
import { publicProfileJob } from '../job-types.ts'
import { noWait, silent, fixturePlan, headlineStep } from './stability-fixtures.ts'
import { recoverInterruptedJob } from '../job-state.ts'

export async function testPersistedRecovery() {
  const plan = fixturePlan([headlineStep, { ...headlineStep, id: 'about', section: 'about',
    payload: { bio: 'New' }, verification: { kind: 'about', expected: 'New' } }])
  for (const failure of ['writing', 'write_accepted']) {
    let writes = 0
    let failedOnce = false
    const profile = { description: 'Old', bio: 'Old' }
    const job: ProfileJob = { jobId: 'job', platformAccountId: 1, clientName: 'Mock',
      status: 'running', phase: '', createdAt: '', updatedAt: '', plan }
    let saved = structuredClone(job)
    const store = { async update(_id: string, patch: Partial<ProfileJob>) {
      const step = patch.result?.steps[0]
      if (!failedOnce && step?.writeIntent && step.status === failure) {
        failedOnce = true; throw new Error('mock Noco outage')
      }
      saved = { ...saved, ...structuredClone(patch) }
    } }
    await new Promise<void>(resolve => runMutation({ job, store, update: patch => Object.assign(job, patch),
      release() {}, client: { async getAccount() { return {} }, async searchParameters() { return [] },
        async getOwnProfile() { return profile }, async updateOwnProfile() {
          writes += 1; profile.description = 'New'
        } }, executorOptions: { timing: noWait, logger: silent, wait: async () => undefined, onSettled: resolve } }))
    assert.equal(writes, failure === 'writing' ? 0 : 1)
    assert.equal(job.status, 'needs_expert_review')
    assert.equal(saved.status, job.status)
    assert.equal(JSON.stringify(publicProfileJob(job).result).includes('writeIntent'), false)
    if (failure === 'write_accepted') {
      const restart: ProfileJob = { ...saved, status: 'running', result: { status: 'running', steps: [{
        stepId: 'headline', section: 'headline', status: 'writing', message: '',
        writeIntent: { step: headlineStep, savedAt: new Date().toISOString() }
      }] } }
      await recoverInterruptedJob(store, restart)
      assert.equal(restart.status, 'verifying')
    }
  }
}
