import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'
import { createInvitationWithdrawal } from './service.ts'
test('saved active run is interrupted on restart; unresolved IDs remain excluded', async () => {
  const f = fixture()
  await f.runtime.store.save(1, { accountId: 'acc_test', attempted: ['1'], run: {
    id: 'old', platformAccountId: 1, accountId: 'acc_test', status: 'running', total: 2, withdrawn: 0, skipped: 0 } })
  const restarted = createInvitationWithdrawal(f.runtime)
  assert.equal((await restarted.status(1))?.status, 'interrupted')
  const preview = await restarted.preview(1)
  assert.deepEqual(preview.items.map(i => i.eligible), [false, true])
  assert.deepEqual(f.calls, [])
})
test('Stop during the random pause cancels remaining work promptly', async () => {
  const f = fixture()
  f.runtime.sleep = async ms => { f.delays.push(ms); await f.service.stop(1) }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'stopped')
  assert.deepEqual(f.calls, ['1']); assert.deepEqual(f.delays, [250])
})
test('expired preview, changed owner and occupied gate do not send', async () => {
  for (const change of ['expire', 'owner', 'gate']) {
    const f = fixture(), preview = await f.service.preview(1)
    if (change === 'expire') f.runtime.now = () => Date.parse('2026-09-18T00:00:00Z')
    if (change === 'owner') f.runtime.account = async id => ({ platformAccountId: id, accountId: 'other', linkedinUrl: '' })
    if (change === 'gate') f.runtime.gate.acquire('profile', '1', '1')
    await assert.rejects(f.service.start(1, preview.token)); assert.deepEqual(f.calls, [])
  }
})
test('Stop during a 429 pause respects full Retry-After even across restart', async () => {
  const f = fixture()
  f.runtime.sleep = async () => { await f.service.stop(1) }
  f.provider.cancel = async (_a, id) => { f.calls.push(id); throw { details: { httpStatus: 429, retryAfterMs: 600_000 } } }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'uncertain')
  await assert.rejects(createInvitationWithdrawal(f.runtime).preview(1), /Unipile ограничил/)
  assert.equal(f.stored()?.retryAt, f.runtime.now() + 600_000); assert.deepEqual(f.calls, ['1'])
})
test('accepted since preview is skipped; provider reads fail closed; read-back does not blindly repeat', async () => {
  const f = fixture(), preview = await f.service.preview(1)
  f.pending([{ id: '2', name: 'Still pending', createdAt: '2026-08-01T00:00:00Z' }])
  const cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => {
    if (id === '1') { f.calls.push(id); throw { details: { httpStatus: 404 } } }
    await cancel(account, id)
  }
  await f.service.start(1, preview.token)
  assert.equal((await finished(f.service))?.skipped, 1); assert.deepEqual(f.calls, ['1', '2'])
  assert.deepEqual(f.stored()?.run?.noLongerPending, ['1'])
  const g = fixture()
  g.provider.cancel = async (_a, id) => { g.calls.push(id) }
  await g.service.start(1, (await g.service.preview(1)).token)
  assert.equal((await finished(g.service))?.status, 'uncertain'); assert.deepEqual(g.calls, ['1', '2'])
})
test('close awaits in-flight write and read-back without starting the next one', async () => {
  const f = fixture(), cancel = f.provider.cancel
  let release!: () => void, began!: () => void
  const started = new Promise<void>(resolve => { began = resolve })
  f.provider.cancel = async (a, id) => { began(); await new Promise<void>(resolve => { release = resolve }); await cancel(a, id) }
  await f.service.start(1, (await f.service.preview(1)).token); await started
  const closing = f.service.close()
  assert.equal(f.service.busy(), true)
  release(); await closing
  assert.deepEqual(f.calls, ['1']); assert.equal((await f.service.status(1))?.status, 'stopped')
})
