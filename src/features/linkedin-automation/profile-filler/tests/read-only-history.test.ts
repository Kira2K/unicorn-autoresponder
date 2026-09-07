import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { ProfileJob } from '../job-types.ts'
import { fixturePlan, headlineStep, silent } from './stability-fixtures.ts'
const require = createRequire(resolve('package.json'))
const { createProfileFillerService } = require('./src/features/linkedin-automation/profile-filler/service.ts') as {
  createProfileFillerService(options: unknown): {
    get(id: string): Promise<ProfileJob>; list(): Promise<ProfileJob[]>
  }
}

export async function testReadOnlyHistory() {
  const job: ProfileJob = { jobId: 'saved', platformAccountId: 7, clientName: 'Mock',
    status: 'running', phase: 'writing', createdAt: '', updatedAt: '', plan: fixturePlan([headlineStep]),
    result: { status: 'verifying', steps: [{ stepId: 'headline', section: 'headline', status: 'writing',
      message: '', writeIntent: { step: headlineStep, savedAt: new Date(0).toISOString() } }] } }
  const initial = structuredClone(job)
  let writes = 0, reads = 0, gates = 0
  const service = createProfileFillerService({ store: {
    async get() { return job }, async list() { return [job] },
    async update() { writes += 1 }
  }, client: { async getOwnProfile() { reads += 1; return {} } },
    gate: { acquire() { gates += 1; return () => undefined } }, executorOptions: { logger: silent } })
  assert.equal((await service.get(job.jobId)).status, 'verifying')
  assert.equal((await service.list())[0].status, 'verifying')
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(writes, 0, 'GET must not persist recovery or start verification')
  assert.equal(reads, 0, 'GET must not start provider read-back')
  assert.equal(gates, 0, 'GET must not acquire a writer gate')
  assert.deepEqual(job, initial, 'Read projection must not modify the stored object')
}
