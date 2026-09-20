import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'
import { createInvitationWithdrawal } from './service.ts'
test('all old pending invitations, including outside our history, are withdrawn once', async () => {
  const f = fixture(), preview = await f.service.preview(1)
  assert.equal(f.calls.length, 0)
  const run = await f.service.start(1, preview.token)
  await f.service.start(1, preview.token)
  assert.equal((await finished(f.service))?.withdrawn, 2)
  assert.deepEqual(f.calls, ['1', '2'])
  assert.equal(f.delays.reduce((a, b) => a + b, 0), 7500)
  assert.equal((await createInvitationWithdrawal(f.runtime).status(1))?.id, run.id)
  assert.deepEqual((await f.service.preview(1)).items, [])
})
test('timeout after a possible write stops queue; new scan and restart never repeat it', async () => {
  const f = fixture()
  f.provider.cancel = async (_a, id) => { f.calls.push(id); throw new Error('timeout') }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'uncertain')
  assert.deepEqual(f.calls, ['1'])
  const next = await createInvitationWithdrawal(f.runtime).preview(1)
  assert.equal(next.items.find(i => i.id === '1')?.eligible, false)
})
test('read-only, wrong account, expired/unknown confirmation and concurrent starts cannot write', async () => {
  const f = fixture()
  await assert.rejects(f.service.preview(2))
  await assert.rejects(f.service.start(1, 'made-up'))
  const { token } = await f.service.preview(1)
  f.readonly(); await assert.rejects(f.service.start(1, token))
  assert.deepEqual(f.calls, [])
})
test('failed intent save prevents POST; failed result save prevents next POST', async () => {
  for (const save of [2, 3]) {
    const f = fixture(); f.failSave(save)
    await f.service.start(1, (await f.service.preview(1)).token)
    await finished(f.service)
    assert.equal(f.calls.length, save === 2 ? 0 : 1)
  }
})
test('Stop during a write finishes read-back and prevents the next cancellation', async () => {
  const f = fixture(), cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => { await f.service.stop(1); await cancel(account, id) }
  await f.service.start(1, (await f.service.preview(1)).token)
  const run = await finished(f.service)
  assert.equal(run?.status, 'stopped'); assert.equal(run?.withdrawn, 1)
  assert.deepEqual(f.calls, ['1'])
})
test('a queue visits the entire confirmed list, not only the first UI or API page', async () => {
  const f = fixture()
  f.pending(Array.from({ length: 237 }, (_, i) => ({ id: String(i), name: `Person ${i}`,
    createdAt: '2026-08-01T00:00:00Z' })))
  const preview = await f.service.preview(1)
  await f.service.start(1, preview.token)
  assert.equal((await finished(f.service))?.withdrawn, 237)
  assert.equal(new Set(f.calls).size, 237)
})
test('simultaneous starts acquire one gate; initial save failure authorizes no write', async () => {
  const f = fixture(), preview = await f.service.preview(1)
  const results = await Promise.allSettled([f.service.start(1, preview.token), f.service.start(1, preview.token)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  await finished(f.service); assert.deepEqual(f.calls, ['1', '2'])
  const g = fixture(); g.failSave(1)
  await assert.rejects(g.service.start(1, (await g.service.preview(1)).token))
  assert.deepEqual(g.calls, [])
})

test('each gap draws a new random delay within two to thirteen seconds', async () => {
  const f = fixture(), random = [0, 1, 0.5], times: number[] = []
  let elapsed = 0, draws = 0
  const cancel = f.provider.cancel
  f.pending([1, 2, 3, 4].map(id => ({ id: String(id), name: `Test ${id}`, createdAt: '2026-08-01T00:00:00Z' })))
  f.runtime.random = () => random[draws++]
  f.runtime.sleep = async ms => { elapsed += ms }
  f.provider.cancel = async (account, id) => { times.push(elapsed); await cancel(account, id) }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.withdrawn, 4)
  assert.equal(draws, 3)
  assert.deepEqual(times, [0, 2000, 15000, 22500])
})
