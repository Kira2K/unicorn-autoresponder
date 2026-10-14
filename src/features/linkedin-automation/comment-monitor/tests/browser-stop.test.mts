import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { createRequire } from 'node:module'
const { createCommentMonitorService } = createRequire(import.meta.url)('../service.ts')

for (const outcome of ['dolphin', 'octo', 'sql-error']) {
  test(`Stop during fresh browser read remains disabled: ${outcome}`, async () => {
    let resolveRead!: (row: unknown) => void, rejectRead!: (error: unknown) => void
    const pending = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject })
    let lookupStarted!: () => void
    const started = new Promise<void>(resolve => { lookupStarted = resolve })
    const row = { platformAccountId: 7, clientName: 'Fixture', browser: 'dolphin',
      unipileAccountId: 'fixture', unipileAccountStatus: 'running', lastVerifiedAt: 'now' }
    const jobs = new Map<string, any>(), updates: string[] = []
    let reads = 0, providerCalls = 0, modelCalls = 0
    const service = createCommentMonitorService({ autoStart: false, loggerFor: () => ({ event() {} }),
      repository: { async listAccounts() { return [row] }, async getAccount() {
        if (++reads === 1) return row
        lookupStarted(); return pending
      } },
      store: { async list() { return [] }, async purge() {}, async create(job: any) { jobs.set(job.jobId, structuredClone(job)) },
        async update(job: any) { updates.push(job.status); jobs.set(job.jobId, structuredClone(job)) } },
      adapter: { async getAccount() { providerCalls++; return { user_id: 'fixture-user' } },
        async listPosts() { providerCalls++; return { items: [{ id: 'fixture-post', text: 'Fixture' }] } },
        async listComments() { providerCalls++; return { items: [] } },
        async reply() { providerCalls++; throw Error('Unexpected reply') } },
      openai: { async generate() { modelCalls++; throw Error('Unexpected generation') } } })
    try {
      const job = await service.enable(7)
      await started
      const disabled = await service.disable(7), callsAtStop = providerCalls
      assert.equal(disabled.status, 'disabled')
      if (outcome === 'sql-error') rejectRead(Object.assign(Error('Read unavailable'), { code: 'connection_storage_read_unavailable' }))
      else resolveRead({ ...row, ...(outcome === 'octo' ? { browser: 'octo' } : {}) })
      await setImmediate()
      assert.equal((await service.get(job.jobId)).status, 'disabled')
      assert.equal(jobs.get(job.jobId).status, 'disabled')
      assert.equal(jobs.get(job.jobId).finishedAt, disabled.finishedAt)
      assert.equal(jobs.get(job.jobId).nextCheckAt, undefined)
      assert.deepEqual(updates, ['disabled'])
      assert.equal(providerCalls, callsAtStop)
      assert.equal(modelCalls, 0)
    } finally { resolveRead(row); service.stop() }
  })
}
