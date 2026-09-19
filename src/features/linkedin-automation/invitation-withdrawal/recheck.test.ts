import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'
import { createInvitationWithdrawal } from './service.ts'

async function uncertain() {
  const f = fixture(), cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => { await cancel(account, id); throw new Error('response lost') }
  await f.service.start(1, (await f.service.preview(1)).token)
  const run = (await finished(f.service))!
  return { ...f, run }
}
test('recheck updates saved count once, survives restart, and does not resume remaining cancellations', async () => {
  const f = await uncertain(), next = await f.service.preview(1)
  await assert.rejects(f.service.start(1, next.token), /Проверьте результат/)
  const result = await f.service.recheck(1, f.run.id)
  assert.equal(result?.status, 'stopped'); assert.equal(result?.withdrawn, 1)
  assert.equal(result?.current, undefined); assert.equal(result?.error, undefined)
  assert.ok(result?.checkedAt)
  assert.equal((await f.service.recheck(1, f.run.id))?.withdrawn, 1)
  const restarted = createInvitationWithdrawal(f.runtime)
  assert.equal((await restarted.status(1))?.withdrawn, 1)
  assert.equal((await restarted.recheck(1, f.run.id))?.withdrawn, 1)
  assert.deepEqual(f.calls, ['1']); assert.deepEqual(f.stored()?.attempted, ['1'])
})
test('last invitation resolves to completed; missing intent or changed identity cannot confirm', async () => {
  const f = await uncertain(), state = f.stored()!
  state.run!.total = 1; await f.runtime.store.save(1, state)
  assert.equal((await f.service.recheck(1, f.run.id))?.status, 'completed')
  for (const change of ['identity', 'intent', 'token', 'readonly']) {
    const g = await uncertain(), before = g.stored()
    if (change === 'identity') g.runtime.account = async id => ({ platformAccountId: id, accountId: 'different', linkedinUrl: '' })
    if (change === 'intent') { const broken = g.stored()!; broken.attempted = []; await g.runtime.store.save(1, broken) }
    if (change === 'readonly') g.readonly()
    await assert.rejects(g.service.recheck(1, change === 'token' ? 'other' : g.run.id))
    assert.equal(g.stored()?.run?.withdrawn, before?.run?.withdrawn); assert.deepEqual(g.calls, ['1'])
  }
})
test('save failure or lost save response cannot show false success or count the same ID twice', async () => {
  for (const committed of [false, true]) {
    const f = await uncertain(), save = f.runtime.store.save
    f.runtime.store.save = async (id, state) => { if (committed) await save(id, state); throw new Error('save unavailable') }
    await assert.rejects(f.service.recheck(1, f.run.id))
    assert.equal((await f.service.status(1))?.status, 'uncertain')
    f.runtime.store.save = save
    assert.equal((await f.service.recheck(1, f.run.id))?.withdrawn, 1)
    assert.deepEqual(f.calls, ['1'])
  }
})
test('pending, failed verification/read and 429 keep uncertainty; active recheck excludes duplicate work', async () => {
  const f = await uncertain()
  f.pending([{ id: '1', name: 'Pending', createdAt: '2026-08-01T00:00:00Z' }])
  assert.equal((await f.service.recheck(1, f.run.id))?.status, 'uncertain')
  assert.equal((await f.service.status(1))?.withdrawn, 0)
  f.provider.verify = async () => { throw new Error('Wrong owner') }
  await assert.rejects(f.service.recheck(1, f.run.id)); f.provider.verify = async () => {}
  f.provider.list = async () => { throw { details: { httpStatus: 429, retryAfterMs: 600_000 } } }
  await assert.rejects(f.service.recheck(1, f.run.id)); assert.equal(f.stored()?.retryAt, f.runtime.now() + 600_000)
  await assert.rejects(f.service.recheck(1, f.run.id), /Unipile ограничил/)
  const g = await uncertain(), preview = await g.service.preview(1)
  let release!: () => void, started!: () => void
  const began = new Promise<void>(resolve => { started = resolve })
  g.provider.list = async () => { started(); await new Promise<void>(resolve => { release = resolve }); return [] }
  const checking = g.service.recheck(1, g.run.id); await began
  await assert.rejects(g.service.recheck(1, g.run.id)); await assert.rejects(g.service.start(1, preview.token))
  const closing = g.service.close(); release(); await checking; await closing
  assert.deepEqual(g.calls, ['1']); assert.equal(g.service.busy(), false)
})
