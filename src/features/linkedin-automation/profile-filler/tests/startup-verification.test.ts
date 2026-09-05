import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { ProfileJob } from '../job-types.ts'
import { createVerificationRecovery } from '../verification-recovery.ts'
import { fixturePlan, headlineStep, noWait, silent } from './stability-fixtures.ts'

const require = createRequire(resolve('package.json'))
const { createProfileFillerService } = require('./src/features/linkedin-automation/profile-filler/service.ts') as {
  createProfileFillerService(options: unknown): { recoverPending(): Promise<void> }
}
const { createProfileJobStore } = require('./src/features/linkedin-automation/profile-filler/noco-job-store.ts') as {
  createProfileJobStore(client: unknown): { listPendingVerification(): Promise<ProfileJob[]> }
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve))

export async function testStartupVerification() {
  let filteredReads = 0
  const filteredStore = createProfileJobStore({ config: { baseId: 'mock' },
    async request(method: string) {
      assert.equal(method, 'get'); return { list: [{ id: 'jobs', title: 'linkedin_profile_jobs' }] }
    },
    async fetchRecords(table: string, _limit: number, query: { where: string }) {
      filteredReads += 1
      assert.equal(table, 'jobs')
      assert.equal(query.where, '(status,eq,running)~or(status,eq,verifying)')
      return []
    }
  })
  assert.deepEqual(await filteredStore.listPendingVerification(), [])
  assert.equal(filteredReads, 1)
  const job: ProfileJob = { jobId: 'recover', platformAccountId: 7, clientName: 'Mock',
    status: 'running', phase: 'writing', createdAt: '', updatedAt: '', plan: fixturePlan([headlineStep]),
    result: { status: 'verifying', steps: [{ stepId: 'headline', section: 'headline', status: 'writing',
      message: '', writeIntent: { step: headlineStep, savedAt: new Date(0).toISOString() } }],
    verification: { startedAt: new Date(0).toISOString(), attempt: 1, maxAttempts: 2,
      nextReadBackAt: new Date(5_000).toISOString(), notBefore: new Date(9_000).toISOString() } } }
  const oldGeneration = { ...structuredClone(job), jobId: 'old-generation', status: 'retrying' as const }
  const savedGeneration = structuredClone(oldGeneration)
  let listCalls = 0
  let getCalls = 0
  let writes = 0
  let clock = 1_000
  const pauses: number[] = []
  const service = createProfileFillerService({ store: {
    async listPendingVerification() { listCalls += 1; return [job, oldGeneration] },
    async get() { getCalls += 1; return job },
    async update(id: string, patch: Partial<ProfileJob>) {
      assert.equal(id, job.jobId); Object.assign(job, structuredClone(patch))
    }
  }, client: { async getOwnProfile(_id: string, _sections: string[], options: { fresh?: boolean }) {
    assert.equal(options.fresh, true); return { description: 'New' }
  }, async updateOwnProfile() { writes += 1 } },
    gate: { acquire() { return () => undefined } },
    executorOptions: { timing: noWait, logger: silent, clock: () => clock,
      wait: async (ms: number) => { pauses.push(ms); clock += ms } }
  })
  await Promise.all([service.recoverPending(), service.recoverPending()])
  for (let attempt = 0; attempt < 30 && job.status !== 'succeeded'; attempt += 1) await turn()
  assert.equal(job.status, 'succeeded', 'Recovery must finish without UI get/list polling')
  assert.equal(getCalls, 0)
  assert.equal(listCalls, 1)
  assert.equal(writes, 0)
  assert.equal(pauses[0], 8_000, 'Restore saved schedule and full provider cooldown')
  assert.deepEqual(oldGeneration, savedGeneration)

  const scheduled: Array<() => void> = []
  let resumes = 0
  let scans = 0
  const waiting = { ...structuredClone(job), status: 'verifying' as const }
  const recovery = createVerificationRecovery({ async list() { scans += 1; return [waiting] },
    isActive: () => false, async recover(value) { return value },
    async resume() { return ++resumes > 1 }, logger: silent,
    schedule: action => scheduled.push(action) })
  await recovery.start()
  assert.equal(scheduled.length, 1, 'Retry a busy account gate without a browser')
  scheduled.shift()!()
  await turn()
  assert.equal(resumes, 2)
  assert.equal(scans, 1, 'A gate retry must not rescan Noco')
}
