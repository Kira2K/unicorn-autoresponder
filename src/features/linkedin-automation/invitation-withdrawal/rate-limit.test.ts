import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, finished } from './test-fixture.ts'
import { withdrawalRetryAt } from './policy.ts'

const limited = (retryAfterMs?: number) => ({ code: 'unipile_api_too_many_requests',
  details: { httpStatus: 429, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } })
function clock(f: ReturnType<typeof fixture>) {
  let now = f.runtime.now()
  f.runtime.now = () => now
  f.runtime.sleep = async ms => { f.delays.push(ms); now += ms }
}
test('withdrawals use the existing Inviter backoff and preserve a longer Retry-After', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map(attempt => withdrawalRetryAt(limited(), 0, attempt)),
    [180_000, 360_000, 720_000, 1_440_000, 1_800_000, 1_800_000])
  assert.equal(withdrawalRetryAt(limited(3_600_000), 0), 3_600_000)
  assert.equal(withdrawalRetryAt({ details: { httpStatus: 503 } }, 0), undefined)
})
test('429 during verification or batch check pauses, then continues the same approved queue', async () => {
  for (const operation of ['verify', 'list'] as const) {
    const f = fixture(), preview = await f.service.preview(1)
    clock(f)
    const original = f.provider[operation]
    let attempts = 0
    f.provider[operation] = (async () => { if (++attempts === 1) throw limited(); return original() }) as any
    await f.service.start(1, preview.token)
    assert.equal((await finished(f.service))?.status, 'completed')
    assert.deepEqual(f.calls, ['1', '2'])
    assert.equal(f.delays.reduce((a, b) => a + b, 0), 187_500)
    assert.equal(f.stored()?.retryAt, undefined)
  }
})
test('429 after POST retries only read-back with saved growing waits, without a new confirmation', async () => {
  const f = fixture(), list = f.provider.list, save = f.runtime.store.save
  clock(f)
  const waits: number[] = []
  f.runtime.store.save = async (id, state) => {
    if (state.run?.retryAttempt) {
      waits.push(state.retryAt! - f.runtime.now())
      assert.equal(state.run.nextActionAt, new Date(state.retryAt!).toISOString())
      assert.equal(state.run.current, undefined); assert.equal(state.run.withdrawn, 2)
      assert.deepEqual(state.run.confirmed, ['1', '2'])
    }
    await save(id, state)
  }
  let failures = 0
  f.provider.list = async () => {
    if (f.calls.length === 2 && failures++ < 2) throw limited()
    return list()
  }
  await f.service.start(1, (await f.service.preview(1)).token)
  assert.equal((await finished(f.service))?.status, 'completed')
  assert.deepEqual(waits, [180_000, 360_000]); assert.deepEqual(f.calls, ['1', '2'])
  assert.equal(f.delays.reduce((a, b) => a + b, 0), 547_500)
  assert.equal(f.stored()?.run?.retryAttempt, undefined)
})
test('429 on cancel is followed only by read-back; absent continues, present stays uncertain', async () => {
  for (const applied of [true, false]) {
    const f = fixture(), cancel = f.provider.cancel
    clock(f)
    f.provider.cancel = async (account, id) => {
      if (applied || id !== '1') await cancel(account, id)
      else f.calls.push(id)
      if (id === '1') throw limited(600_000)
    }
    await f.service.start(1, (await f.service.preview(1)).token)
    const result = await finished(f.service)
    assert.equal(result?.status, applied ? 'completed' : 'uncertain')
    assert.equal(result?.withdrawn, applied ? 1 : 0)
    assert.deepEqual(result?.noLongerPending, applied ? ['1'] : [])
    assert.deepEqual(f.calls, applied ? ['1', '2'] : ['1'])
    assert.ok(f.delays.reduce((a, b) => a + b, 0) >= 600_000)
    assert.equal(f.stored()?.attempted.filter(id => id === '1').length, 1)
  }
})
