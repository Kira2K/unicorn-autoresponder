import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'

test('delayed visibility is confirmed by bounded reads without repeating a cancellation', async () => {
  const f = fixture(), list = f.provider.list, cancel = f.provider.cancel
  let stale = 0, old: Awaited<ReturnType<typeof list>> = []
  f.provider.cancel = async (a, id) => { old = await list(); await cancel(a, id); stale = 2 }
  f.provider.list = async () => stale-- > 0 ? structuredClone(old) : list()
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'completed')
  assert.equal((await f.service.status(1))?.withdrawn, 2)
  assert.deepEqual(f.calls, ['1', '2'])
  assert.equal(f.delays.reduce((a, b) => a + b, 0), 10500)
})

test('still pending after three reads stops; non-429 read failures are not retried blindly', async () => {
  for (const mode of ['pending', 'timeout']) {
    const f = fixture(), list = f.provider.list
    let checking = false, reads = 0
    f.provider.cancel = async (_a, id) => { f.calls.push(id); checking = true }
    f.provider.list = async () => {
      if (!checking) return list()
      reads++
      if (mode === 'timeout') throw new Error('timeout')
      return list()
    }
    await f.service.start(1, (await f.service.preview(1)).token)
    assert.equal((await finished(f.service))?.status, 'uncertain')
    assert.equal(reads, mode === 'pending' ? 3 : 1)
    assert.deepEqual(f.calls, ['1', '2'])
    assert.deepEqual(f.stored()?.run?.confirmed, ['1', '2'])
    assert.equal(f.stored()?.run?.checkedAt, undefined)
  }
})

test('preview is reused; successful cancellations share one final full-list check', async () => {
  const f = fixture(), list = f.provider.list
  const reads: number[] = []
  f.provider.list = async () => { reads.push(f.calls.length); return list() }
  await f.service.start(1, (await f.service.preview(1)).token)
  const run = await finished(f.service)
  assert.equal(run?.status, 'completed'); assert.ok(run?.checkedAt)
  assert.deepEqual(reads, [0, 2]); assert.deepEqual(run?.confirmed, ['1', '2'])
})

test('batch check verifies every canceled ID, not just the last', async () => {
  const f = fixture(), cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => { if (id === '1') f.calls.push(id); else await cancel(account, id) }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'uncertain')
  assert.deepEqual(f.calls, ['1', '2'])
})
