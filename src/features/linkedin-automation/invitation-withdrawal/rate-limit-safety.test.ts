import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'
import { createInvitationWithdrawal } from './service.ts'

const limited = { code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 3_600_000 } }
test('Stop/close interrupts a saved pause; restart neither sends nor reads before the deadline', async () => {
  for (const afterPost of [false, true]) {
    const f = fixture(), preview = await f.service.preview(1), list = f.provider.list
    let release!: () => void, entered!: () => void, reads = 0
    const waiting = new Promise<void>(resolve => { entered = resolve })
    if (afterPost) f.provider.list = async () => { reads++; throw limited }
    else f.provider.verify = async () => { reads++; throw limited }
    f.runtime.sleep = async () => {
      if (!f.stored()?.run?.retryAttempt) return
      entered(); await new Promise<void>(resolve => { release = resolve })
    }
    await f.service.start(1, preview.token); await waiting
    assert.equal(f.stored()?.retryAt, f.runtime.now() + 3_600_000)
    assert.equal((await f.service.status(1))?.retryAttempt, 1)
    const restarted = createInvitationWithdrawal(f.runtime)
    assert.equal((await restarted.status(1))?.status, 'interrupted')
    await assert.rejects(restarted.preview(1), /Unipile ограничил/)
    const before = reads, closing = f.service.close(); release(); await closing
    await assert.rejects(restarted.recheck(1, preview.token), /Unipile ограничил/)
    assert.equal(reads, before)
    assert.equal((await f.service.status(1))?.status, afterPost ? 'uncertain' : 'stopped')
    assert.deepEqual(f.calls, afterPost ? ['1', '2'] : [])
    assert.equal(f.service.busy(), false)
  }
})
test('failed pause save or failed success save blocks further reads/writes, including a lost save acknowledgement', async () => {
  for (const phase of ['pause', 'success']) for (const committed of [false, true]) {
    const f = fixture(), list = f.provider.list, save = f.runtime.store.save
    let now = f.runtime.now(), limitedOnce = false, paused = false, reads = 0
    f.runtime.now = () => now; f.runtime.sleep = async ms => { now += ms }
    f.provider.list = async () => {
      if (f.calls.length) { reads++; if (!limitedOnce) { limitedOnce = true; throw limited } }
      return list()
    }
    f.runtime.store.save = async (id, state) => {
      const pause = Boolean(state.run?.retryAttempt)
      const fail = limitedOnce && (phase === 'pause' ? pause : paused && !pause)
      paused ||= pause
      if (!fail || committed) await save(id, state)
      if (fail) throw new Error('save failed')
    }
    await f.service.start(1, (await f.service.preview(1)).token)
    assert.equal((await finished(f.service))?.status, 'uncertain')
    assert.deepEqual(f.calls, ['1', '2']); assert.equal(reads, phase === 'pause' ? 1 : 2)
  }
})
test('writer ownership lost during the pause blocks the next provider request', async () => {
  const f = fixture(), preview = await f.service.preview(1)
  let reads = 0
  f.provider.verify = async () => { reads++; throw limited }
  f.runtime.sleep = async () => { f.readonly() }
  await f.service.start(1, preview.token)
  assert.equal((await finished(f.service))?.status, 'failed')
  assert.equal(reads, 1); assert.deepEqual(f.calls, [])
})
test('stopped batch check can finish later without losing or repeating confirmed cancellations', async () => {
  const f = fixture(), list = f.provider.list
  f.provider.list = async () => { if (f.calls.length) throw limited; return list() }
  f.runtime.sleep = async () => { await f.service.stop(1) }
  await f.service.start(1, (await f.service.preview(1)).token)
  const run = (await finished(f.service))!, retryAt = f.stored()!.retryAt!
  f.runtime.now = () => retryAt; f.provider.list = list
  const result = await f.service.recheck(1, run.id)
  assert.equal(result?.withdrawn, 1); assert.equal(result?.retryAttempt, undefined)
  assert.equal(f.stored()?.retryAt, undefined); assert.deepEqual(f.calls, ['1'])
})
test('failure to save Stop before a POST is shown explicitly, without losing the saved pause', async () => {
  const f = fixture(), preview = await f.service.preview(1), save = f.runtime.store.save
  f.provider.verify = async () => { throw limited }
  f.runtime.sleep = async () => { await f.service.stop(1) }
  f.runtime.store.save = async (id, state) => {
    if (state.run?.stopRequested) throw new Error('Save failed')
    await save(id, state)
  }
  await f.service.start(1, preview.token)
  const result = await finished(f.service)
  assert.match(result?.error ?? '', /^Не удалось сохранить итог/)
  assert.equal(f.stored()?.retryAt, f.runtime.now() + 3_600_000)
  assert.deepEqual(f.calls, [])
})
