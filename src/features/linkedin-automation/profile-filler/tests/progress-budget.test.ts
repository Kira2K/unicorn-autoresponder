import assert from 'node:assert/strict'
import { runMutation } from '../mutation-run.ts'
import type { ProfileJob } from '../job-types.ts'
import { executeProfilePlan, resumeProfileVerification } from '../executor.ts'
import type { FillResult, ProfileClient } from '../plan-types.ts'
import { fixturePlan, headlineStep, noWait, silent } from './stability-fixtures.ts'

export async function testProgressBudget() {
  const plan = fixturePlan([headlineStep, { ...headlineStep, id: 'about', section: 'about',
    payload: { bio: 'New' }, verification: { kind: 'about', expected: 'New' } }])
  const job: ProfileJob = { jobId: 'budget', platformAccountId: 1, clientName: 'Mock',
    status: 'running', phase: 'starting', createdAt: '', updatedAt: '', plan }
  const saved: Partial<ProfileJob>[] = []
  const shown: string[] = []
  const profile = { description: 'Old', bio: 'Old' }
  let writes = 0
  let progressEvents = 0
  await new Promise<void>(resolve => runMutation({ job,
    store: { async update(_id, patch) { saved.push(structuredClone(patch)) } },
    update: patch => Object.assign(job, patch), release() {},
    client: { async getAccount() { return {} }, async searchParameters() { return [] },
      async getOwnProfile() { return structuredClone(profile) },
      async updateOwnProfile(_id, payload) {
        assert.ok(saved.at(-1)?.result?.steps[writes].writeIntent, 'durable intent before PATCH')
        writes += 1
        if (payload.bio) profile.bio = String(payload.bio)
        else profile.description = 'New'
      } },
    executorOptions: { timing: noWait, logger: silent, wait: async () => undefined,
      onProgress: result => { progressEvents += 1; shown.push(...result.steps.map(step => step.status)) }, onSettled: resolve }
  }))
  assert.equal(writes, 2)
  assert.equal(saved.length, 6, '2 per step + final verification schedule + terminal save')
  assert.equal(progressEvents + 1, 17, 'previous policy persisted every event plus the terminal job status')
  assert.equal(saved.filter(patch => patch.status === 'succeeded').length, 1)
  assert.equal(job.status, 'succeeded')
  assert.equal(saved.at(-1)?.result?.status, 'verified')
  assert.ok(shown.includes('waiting') && shown.includes('write_accepted'), 'UI retains detailed progress')
  for (const patch of saved) {
    for (const step of patch.result?.steps ?? []) {
      if (step.status === 'verifying') assert.ok(step.nextActionAt, 'read-back timer is durable')
    }
  }
}

export async function testStoredRetryTimer() {
  for (const code of ['unipile_timeout', 'unipile_api_too_many_requests']) {
    let clock = 0, writes = 0, readAt = 0
    let saved: FillResult | undefined
    const plan = fixturePlan([headlineStep])
    const client: ProfileClient = {
      async getAccount() { return {} }, async searchParameters() { return [] },
      async getOwnProfile() { readAt = clock; return { description: writes ? 'New' : 'Old' } },
      async updateOwnProfile() {
        writes += 1
        throw Object.assign(new Error('mock provider failure'), { code,
          details: { httpStatus: code === 'unipile_timeout' ? 504 : 429, retryAfterMs: 120_000 } })
      }
    }
    await assert.rejects(executeProfilePlan(client, plan, { timing: noWait, logger: silent,
      clock: () => clock, onProgress(result, persistence) {
        if (persistence !== 'memory') saved = structuredClone(result)
      }, wait: async () => { if (writes) throw new Error('simulated restart') }
    }), /simulated restart/)
    assert.equal(saved?.steps[0].status, 'verifying')
    assert.ok(saved?.steps[0].writeIntent)
    assert.equal(Date.parse(saved!.steps[0].nextActionAt!), 120_000)
    clock = 10_000
    const recovered = await resumeProfileVerification(client, plan, saved!, {
      timing: noWait, logger: silent, clock: () => clock, wait: async ms => { clock += ms }
    })
    assert.equal(readAt, 120_000, 'restart preserves the remaining provider cooldown')
    assert.equal(writes, 1, 'recovery only reads; it never repeats PATCH')
    assert.equal(recovered.status, 'verified')
  }
}
