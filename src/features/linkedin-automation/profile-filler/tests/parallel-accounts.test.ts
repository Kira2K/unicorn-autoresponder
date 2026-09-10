import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { ProfileJob } from '../job-types.ts'
import type { ProfileClient } from '../plan-types.ts'
import type { ProfileFillerService } from '../../../web-console/backend/profile-filler-types.ts'
import { fixtureProfile, noWait, silent } from './stability-fixtures.ts'
const require = createRequire(resolve('package.json'))
const { createProfileFillerService } = require('./src/features/linkedin-automation/profile-filler/service.ts') as {
  createProfileFillerService(options: unknown): ProfileFillerService
}
const { createLinkedInOperationGate } = require('./src/features/web-console/backend/linkedin-operation-gate.ts') as
  { createLinkedInOperationGate(): {
    acquire(kind: string, id: string, accountKey?: string): () => void
    current(accountKey?: string): { kind: string; id: string } | undefined
  } }
async function until(check: () => boolean | Promise<boolean>) {
  for (let turn = 0; turn < 100; turn++) {
    if (await check()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('Parallel job did not reach the expected state')
}

export async function testParallelAccounts() {
  const records = new Map<string, ProfileJob>(), writes: string[] = []
  const releaseWrite = new Map<string, () => void>()
  const profiles = new Map([1, 2].map(id => [`acc-${id}`, { ...fixtureProfile(),
    public_identifier: `student-${id}`, provider_id: `provider-acc-${id}`,
    name: `Student ${id}`, profile_url: `https://www.linkedin.com/in/student-${id}/` }]))
  const store = {
    async create(job: ProfileJob) { records.set(job.jobId, structuredClone(job)) },
    async update(id: string, patch: Partial<ProfileJob>) { Object.assign(records.get(id)!, structuredClone(patch)) },
    async get(id: string) { return structuredClone(records.get(id)) },
    async list() { return [...records.values()].map(job => structuredClone(job)) }
  }
  const client: ProfileClient = {
    async getAccount(id) { return { provider: 'linkedin', status: 'running', user_id: `provider-${id}` } },
    async getOwnProfile(id) { return structuredClone(profiles.get(id)!) },
    async searchParameters() { return [] },
    async updateOwnProfile(id) {
      writes.push(id)
      await new Promise<void>(resolve => releaseWrite.set(id, resolve))
      Object.assign(profiles.get(id)!, { description: `New ${id}` })
    }
  }
  const gate = createLinkedInOperationGate()
  const service = createProfileFillerService({ store, client, gate,
    repository: { async listAccounts() { return [1, 2].map(id => ({
      platformAccountId: id, clientName: `Student ${id}`,
      linkedinUrl: `https://www.linkedin.com/in/student-${id}/`, unipileAccountId: `acc-${id}`,
      unipileAccountStatus: 'running', verifiedProviderId: `provider-acc-${id}`,
      lastVerifiedAt: '2026-09-01T00:00:00.000Z'
    })) } }, executorOptions: { timing: noWait, wait: async () => {}, logger: silent } })
  const starts = await Promise.all([1, 2].map(id => service.startPreview(id,
    { schema_version: 1, profile: { headline: `New acc-${id}` } })))
  const ids = starts.map(job => String(job.jobId))
  for (const id of ids) await until(async () => (await service.get(id))?.status === 'preview_ready')
  const jobs = await Promise.all(ids.map(id => service.get(id)))
  try {
    await Promise.all(ids.map((id, index) => service.apply(id, String(jobs[index]!.planHash))))
    await until(() => writes.length === 2)
    assert.deepEqual(new Set(writes), new Set(['acc-1', 'acc-2']))
    assert(gate.current('1') && gate.current('2'), 'both accounts are executing before either PATCH finishes')
    await assert.rejects(service.apply(ids[0], String(jobs[0]!.planHash)), { code: 'profile_job_not_ready' })
    await assert.rejects(service.startPreview(1, { profile: { headline: 'Duplicate' } }),
      { code: 'linkedin_operation_active' })
    releaseWrite.get('acc-1')!()
    await until(async () => (await service.get(ids[0]))?.status === 'succeeded')
    assert.equal((await service.get(ids[1]))?.status, 'running')
    await until(() => !gate.current('1'))
    assert(gate.current('2'))
    releaseWrite.get('acc-2')!()
    await until(async () => (await service.get(ids[1]))?.status === 'succeeded')
    assert.equal(writes.length, 2, 'exactly one PATCH per account')
    for (const id of ids) assert.equal(records.get(id)?.result?.steps[0].status, 'verified')
    await until(() => !gate.current())
  } finally { for (const release of releaseWrite.values()) release() }
}
