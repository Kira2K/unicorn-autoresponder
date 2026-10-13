const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { test } = require('node:test') as typeof import('node:test')
const { createFeedSession, stepFeedSession } = require('./session.mts') as typeof import('./session.mts')
import type { FeedSession, FeedDependencies } from './session.mts'

function fixture() {
  let time = 1_800_000_000_000, calls = 0
  let saved: FeedSession = createFeedSession({ accountId: 'acc_test', now: time })
  const requests: any[] = []
  const deps: FeedDependencies = {
    now: () => time, random: () => 0.5,
    save: async value => { saved = structuredClone(value) },
    read: async input => {
      calls++; requests.push(input)
      return { ids: [`urn:li:activity:${calls}`], rawCount: 1, next: { start: calls, token: 'next' } }
    }
  }
  return { deps, requests, saved: () => structuredClone(saved), calls: () => calls,
    clock: () => time, advance: (ms: number) => { time += ms } }
}

test('random portions persist sizes and pauses; 120 splits into 100 and 20 using the saved cursor', async () => {
  const f = fixture(), draws = [0, 0.999999, 0.999999, 0, 0.5]
  f.deps.random = () => { assert.ok(draws.length); return draws.shift()! }
  let calls = 0
  f.deps.read = async input => {
    calls++
    assert.equal(input.count, [30, 100, 20][calls - 1])
    assert.equal(f.saved().count, input.count)
    assert.equal(f.saved().phase, 'reading')
    const start = input.cursor?.start ?? 0
    assert.equal(start, [0, 30, 130][calls - 1])
    const ids = Array.from({ length: input.count! }, (_, i) => `urn:li:activity:${start + i}`)
    return { ids, rawCount: ids.length, next: { start: start + ids.length, token: 'next' } }
  }
  const initial = createFeedSession({ accountId: 'acc_test', now: f.clock(), randomPageSize: true, maxPages: 3 })
  const first = await stepFeedSession(initial, f.deps)
  assert.equal(first.nextAt, f.clock() + 120_000)
  await stepFeedSession(f.saved(), f.deps); assert.equal(calls, 1); assert.equal(draws.length, 3)
  f.advance(120_000)
  const second = await stepFeedSession(f.saved(), f.deps)
  assert.equal(second.ids.length, 130); assert.equal(second.nextAt, f.clock() + 60_000)
  await stepFeedSession(f.saved(), f.deps); assert.equal(calls, 2); assert.equal(draws.length, 1)
  f.advance(60_000); const third = await stepFeedSession(f.saved(), f.deps)
  assert.equal(third.ids.length, 150); assert.equal(third.phase, 'completed'); assert.equal(draws.length, 0)
})

test('random size is retained on retry and a longer provider deadline wins', async () => {
  const f = fixture(), draws = [0.5, 0, 0.999999]
  f.deps.random = () => { assert.ok(draws.length); return draws.shift()! }
  const until = f.clock() + 300_000
  f.deps.read = async input => { assert.equal(input.count, 75); throw Object.assign(new Error(), { details: { httpStatus: 429, retryAt: until } }) }
  await stepFeedSession(createFeedSession({ accountId: 'acc_test', now: f.clock(), randomPageSize: true }), f.deps)
  assert.equal(f.saved().nextAt, until)
  f.advance(60_000); await stepFeedSession(f.saved(), f.deps)
  assert.equal(draws.length, 1); assert.equal(f.saved().nextAt, until)
  f.advance(240_000)
  f.deps.read = async input => { assert.equal(input.count, 75); return { ids: [], rawCount: 0 } }
  await stepFeedSession(f.saved(), f.deps); assert.equal(draws.length, 0)
})

test('short responses finish the saved portion without a new random draw or repeated cursor', async () => {
  const f = fixture(), draws = [0, 0, 0]
  f.deps.random = () => { assert.ok(draws.length); return draws.shift()! }
  const requested: number[] = []
  f.deps.read = async input => {
    requested.push(input.count!); const start = input.cursor?.start ?? 0
    const ids = Array.from({ length: Math.min(input.count!, 20) }, (_, i) => `urn:li:activity:${start + i}`)
    return { ids, rawCount: ids.length, next: { start: start + ids.length, token: 'next' } }
  }
  await stepFeedSession(createFeedSession({ accountId: 'acc_test', now: f.clock(), randomPageSize: true }), f.deps)
  assert.equal(f.saved().batchRemaining, 10)
  f.advance(60_000); const done = await stepFeedSession(f.saved(), f.deps)
  assert.deepEqual(requested, [30, 10]); assert.equal(done.ids.length, 30); assert.equal(done.batchRemaining, 0)
  assert.equal(draws.length, 0)
})

test('a smaller next page does not invalidate already saved cards; invalid random never sends', async () => {
  const f = fixture(), draws = [0.999999, 0, 0, 0, 0]
  f.deps.random = () => draws.shift()!
  f.deps.read = async input => {
    const start = input.cursor?.start ?? 0
    const ids = Array.from({ length: input.count! }, (_, i) => `urn:li:activity:${start + i}`)
    return { ids, rawCount: ids.length, next: { start: start + ids.length, token: 'next' } }
  }
  await stepFeedSession(createFeedSession({ accountId: 'acc_test', now: f.clock(), randomPageSize: true, maxPages: 3 }), f.deps)
  f.advance(60_000); await stepFeedSession(f.saved(), f.deps)
  f.advance(60_000); const second = await stepFeedSession(f.saved(), f.deps)
  assert.equal(second.count, 30); assert.equal(second.ids.length, 150)
  assert.deepEqual(await stepFeedSession(f.saved(), f.deps), second)
  for (const value of [-1, 1, NaN, Infinity]) {
    const g = fixture(); g.deps.random = () => value
    await assert.rejects(stepFeedSession(createFeedSession({ accountId: 'acc_test', now: g.clock(), randomPageSize: true }), g.deps), /feed_random_invalid/)
    assert.equal(g.calls(), 0)
  }
})

test('two pages with a saved random pause; restart retains position and completion makes no calls', async () => {
  const f = fixture(), initial = f.saved()
  const first = await stepFeedSession(initial, f.deps)
  assert.deepEqual(initial, createFeedSession({ accountId: 'acc_test', now: f.clock() }))
  assert.equal(first.phase, 'waiting'); assert.equal(first.nextAt, f.clock() + 90_000)
  assert.deepEqual(await stepFeedSession(f.saved(), f.deps), first)
  assert.equal(f.calls(), 1)
  f.advance(90_000)
  const done = await stepFeedSession(f.saved(), f.deps)
  assert.equal(done.phase, 'completed'); assert.equal(done.pages, 2)
  assert.deepEqual(f.requests[1].cursor, first.cursor)
  assert.deepEqual(done.ids, ['urn:li:activity:1', 'urn:li:activity:2'])
  await stepFeedSession(f.saved(), f.deps); assert.equal(f.calls(), 2)
})

test('intent must persist before reading; failure saving a result is not treated as a provider retry', async () => {
  const f = fixture()
  f.deps.save = async () => { throw new Error('disk_full') }
  await assert.rejects(stepFeedSession(f.saved(), f.deps), /disk_full/)
  assert.equal(f.calls(), 0)
  let intent: FeedSession | undefined
  f.deps.save = async value => {
    if (value.phase !== 'reading') throw new Error('disk_full')
    intent = structuredClone(value)
  }
  await assert.rejects(stepFeedSession(f.saved(), f.deps), /disk_full/)
  assert.equal(f.calls(), 1); assert.equal(intent?.attempts, 1)
  await assert.rejects(stepFeedSession(intent!, f.deps), /disk_full/)
  f.deps.save = async () => {}
  await stepFeedSession(intent!, f.deps); assert.equal(f.calls(), 1)
})

test('missing read outcome after restart stops; an unsaved Retry-After cannot be bypassed', async () => {
  const f = fixture()
  const first = await stepFeedSession(f.saved(), f.deps)
  f.advance(90_000)
  let intent: FeedSession | undefined
  f.deps.read = async () => { intent = f.saved(); throw new Error('simulated read failure') }
  await stepFeedSession(f.saved(), f.deps)
  assert.equal(intent?.phase, 'reading')
  let calls = 0
  f.deps.read = async () => { calls++; return { ids: [], rawCount: 0 } }
  f.advance(90_000)
  const recovered = await stepFeedSession(intent!, f.deps)
  assert.equal(calls, 0); assert.equal(recovered.attempts, 2); assert.equal(recovered.pages, 1)
  assert.equal(recovered.reason, 'feed_interrupted_read')
  assert.deepEqual(recovered.cursor, first.cursor); assert.deepEqual(recovered.ids, first.ids)
  await stepFeedSession(recovered, f.deps); assert.equal(calls, 0)
})

test('429 keeps the absolute deadline through restart without extending it; no header uses two hours', async () => {
  for (const delay of [undefined, 80_000_000]) {
    const f = fixture(), until = f.clock() + (delay ?? 7_200_000)
    f.deps.read = async () => { throw Object.assign(new Error('private provider text'), {
      details: { httpStatus: 429, ...(delay ? { retryAt: until, retryAfterMs: delay } : {}) }
    }) }
    const waiting = await stepFeedSession(f.saved(), f.deps)
    assert.equal(waiting.nextAt, until); assert.equal(waiting.error?.httpStatus, 429)
    assert.equal(waiting.error?.stage, 'feed_read')
    assert.ok(!JSON.stringify(waiting).includes('private provider text'))
    f.advance(60_000)
    assert.deepEqual(await stepFeedSession(f.saved(), f.deps), waiting)
    f.advance(7_200_000)
    assert.equal((await stepFeedSession(f.saved(), f.deps)).phase, 'stopped')
  }
})

test('500/timeout wait five minutes; shared cooldown is not shortened', async () => {
  for (const error of [Object.assign(new Error(), { details: { httpStatus: 500 } }),
    Object.assign(new Error(), { code: 'unipile_timeout' }),
    Object.assign(new Error(), { code: 'unipile_shared_cooldown', details: { retryAt: 1_800_000_600_000 } })]) {
    const f = fixture()
    f.deps.read = async () => { throw error }
    const state = await stepFeedSession(f.saved(), f.deps)
    assert.equal(state.phase, 'waiting')
    assert.equal(state.nextAt, f.clock() + (('code' in error && error.code === 'unipile_shared_cooldown') ? 600_000 : 300_000))
  }
})

test('Stop before or during a page is final and preserves the received result', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort()
  const stopped = await stepFeedSession(f.saved(), { ...f.deps, signal: controller.signal })
  assert.equal(stopped.phase, 'stopped'); assert.equal(f.calls(), 0)
  await stepFeedSession(stopped, f.deps); assert.equal(f.calls(), 0)
  const g = fixture(), during = new AbortController()
  g.deps.read = async () => {
    during.abort()
    return { ids: ['urn:li:activity:1'], rawCount: 1, next: { start: 1, token: 'next' } }
  }
  const result = await stepFeedSession(g.saved(), { ...g.deps, signal: during.signal })
  assert.equal(result.phase, 'stopped'); assert.equal(result.pages, 1)
  assert.deepEqual(result.cursor, { start: 1, token: 'next' })
})

test('parse errors and repeated pages stop instead of claiming progress', async () => {
  const f = fixture()
  f.deps.read = async () => { throw Object.assign(new Error(), { code: 'feed_graphql_error' }) }
  const error = await stepFeedSession(f.saved(), f.deps)
  assert.equal(error.phase, 'needs_attention'); assert.equal(error.error?.stage, 'feed_parse')
  const g = fixture()
  const first = await stepFeedSession(g.saved(), g.deps)
  g.advance(90_000)
  g.deps.read = async () => ({ ids: first.ids, rawCount: 1, next: { start: 2, token: 'next' } })
  assert.equal((await stepFeedSession(g.saved(), g.deps)).reason, 'feed_no_progress')
})

test('GraphQL diagnosis survives persistence without pretending HTTP 500', async () => {
  const f = fixture()
  f.deps.read = async () => { throw Object.assign(new Error(), { code: 'feed_graphql_error', details: { graphqlDiagnostic: 'errors=1; status=500; type=DataFetchingException' } }) }
  const state = await stepFeedSession(f.saved(), f.deps)
  assert.equal(state.phase, 'needs_attention')
  assert.equal(state.error?.source, 'Unipile')
  assert.equal((state.error as any)?.diagnostic, 'errors=1; status=500; type=DataFetchingException')
  assert.equal(state.error?.httpStatus, undefined)
})

test('empty end, expired session, attempt limit and corrupt state cannot create a request loop', async () => {
  const f = fixture()
  f.deps.read = async () => ({ ids: [], rawCount: 0 })
  assert.equal((await stepFeedSession(f.saved(), f.deps)).reason, 'feed_end')
  const g = fixture(), expired = g.saved()
  g.advance(30 * 60_000)
  assert.equal((await stepFeedSession(expired, g.deps)).reason, 'session_expired')
  assert.equal(g.calls(), 0)
  const h = fixture(), exhausted = h.saved()
  exhausted.attempts = 6
  assert.equal((await stepFeedSession(exhausted, h.deps)).reason, 'attempt_limit')
  assert.equal(h.calls(), 0)
  await assert.rejects(stepFeedSession({ ...exhausted, version: 0 } as any, h.deps), /feed_state_invalid/)
  assert.equal(h.calls(), 0)
})
