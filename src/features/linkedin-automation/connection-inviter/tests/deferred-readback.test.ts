import assert from 'node:assert/strict'
import { createConnectionInviterService } from '../service.ts'
import { fixture } from './fixtures.ts'

async function run() {
  const f = fixture({ stack: 'GO', connectionCount: 149 })
  const original = f.adapter.listPendingInvitations
  let now = Date.parse('2026-09-21T21:30:00Z'), reads = 0, slept = 0, sleptBeforeLimit = 0, locked = false
  f.adapter.listPendingInvitations = async (...args: any[]) => {
    if (++reads === 2) { sleptBeforeLimit = slept; throw Object.assign(Error('quota'), {
      code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 86_400_000 } }) }
    return original(...args)
  }
  const gate = { acquire() { assert.equal(locked, false); locked = true; return () => { locked = false } } }
  const options = { ...f, gate, autoRecover: false, now: () => new Date(now),
    sleep: async (ms: number) => { slept += ms } }
  const service = createConnectionInviterService(options)
  const started = await service.start(7)
  for (let i = 0; i < 150; i++) {
    if ((await f.store.getRun(started.runId))?.stage === 'resolving_uncertain' && !locked) break
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  const deferred = (await f.store.getRun(started.runId))!
  assert.equal(deferred.stage, 'resolving_uncertain')
  assert.equal(deferred.status, 'running')
  assert.equal(locked, false, 'The sleeping read-back must release the account executor.')
  assert.equal(slept, sleptBeforeLimit, 'An entire day must not be spent inside mandatory read-back sleep.')
  assert.equal(f.metrics.sends, 1)
  assert.equal(deferred.counters.sent, 0)
  assert.equal((await f.store.listRunHistory(started.runId, 100))[0].status, 'uncertain')
  const due = deferred.nextActionAt
  service.stop()
  // New process on a later calendar day must still respect the saved Retry-After.
  now += 86_400_000 - 1000
  const restored = createConnectionInviterService(options)
  await restored.recover(); await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(reads, 2); assert.equal(f.metrics.sends, 1); assert.equal(slept, sleptBeforeLimit)
  assert.equal((await f.store.getRun(started.runId))?.nextActionAt, due)
  await restored.stopRun(started.runId)
  assert.equal(reads, 2); assert.equal(f.metrics.sends, 1)
  restored.stop()
}
run().then(() => console.log('connection deferred read-back tests passed'))
  .catch(error => { console.error(error); process.exitCode = 1 })
