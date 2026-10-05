import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccountRequestQueue, createUnipileRequestScheduler } from './request-scheduler.ts'
import { createRequestPolicy } from '../../features/linkedin-automation/orchestrator/request-policy.ts'
import * as httpModule from './http-client.ts'
import * as controlModule from './request-control.ts'
const { createUnipileHttpClient } = (httpModule as any).default ?? httpModule
const { installRequestPolicy, withRequestContext, drainWrites } = (controlModule as any).default ?? controlModule

function boundary() {
  let now = Date.now(); const events: any[] = [], deadlines = new Map<string, number>()
  const store: any = {
    snapshot: async () => ({ schedules: [], tasks: [] }),
    event: async (event: any) => { events.push(event) },
    blockedUntil: async (key: string) => deadlines.get(key) ?? 0,
    cooldown: async (value: any) => deadlines.set(value.account, Math.max(deadlines.get(value.account) ?? 0, value.until))
  }
  const options = { store, now: () => now, random: () => 0, sleep: async (ms: number) => { now += ms },
    resolveKey: (id: string) => id === 'old' || id === 'new' ? 'same-linkedin-id' : id,
    assertOwner: async () => {}, onFailure() {} }
  return { events, deadlines, store, options, now: () => now }
}

test('one account shares spacing across features; longer work and feature pauses do not add waits', async () => {
  let now = 0; const waits: number[] = [], starts: number[] = []
  const queue = createAccountRequestQueue({ now: () => now, random: () => 0,
    sleep: async ms => { waits.push(ms); now += ms } })
  const action = async () => { starts.push(now) }
  await queue.run('diana', action)
  now += 6000 // Previous feature has already waited six seconds.
  await queue.run('diana', action)
  await queue.run('diana', async () => { starts.push(now); now += 30_000 })
  await queue.run('diana', action)
  assert.deepEqual(starts, [0, 10_000, 20_000, 50_000])
  assert.deepEqual(waits, [4000, 10_000])
})

test('requests are FIFO and never overlap for one account; another account runs immediately', async () => {
  let release!: () => void, entered!: () => void, now = 0
  const busy = new Promise<void>(r => { release = r }), began = new Promise<void>(r => { entered = r })
  const queue = createAccountRequestQueue({ now: () => now, random: () => 1, sleep: async ms => { now += ms } })
  const order: string[] = []
  const first = queue.run('diana', async () => { order.push('post'); entered(); await busy })
  await began
  const second = queue.run('diana', async () => { order.push('comments') })
  const third = queue.run('diana', async () => { order.push('withdraw') })
  await queue.run('alzhan', async () => { order.push('other') })
  assert.deepEqual(order, ['post', 'other']); assert.equal(now, 0)
  release(); await Promise.all([first, second, third])
  assert.deepEqual(order, ['post', 'other', 'comments', 'withdraw']); assert.equal(now, 40_000)
})

test('preflight is rechecked after waiting; errors release the queue and do not retry requests', async () => {
  let now = 0, writes = 0, allowed = true
  const queue = createAccountRequestQueue({ now: () => now, random: () => 0.5,
    sleep: async ms => { now += ms; allowed = false } })
  await assert.rejects(queue.run('a', async () => { writes++; throw new Error('lost response') }), /lost response/)
  await assert.rejects(queue.run('a', async () => { writes++ }, {
    prepare: async () => { assert.equal(now, 15_000); if (!allowed) throw new Error('stopped') }
  }), /stopped/)
  assert.equal(writes, 1)
  await queue.run('a', async () => { writes++ }); assert.equal(now, 15_000); assert.equal(writes, 2)
})

test('aborted queued requests do not send and do not block the next request', async () => {
  let now = 0, writes = 0; const stop = new AbortController()
  const queue = createAccountRequestQueue({ now: () => now, random: () => 0,
    sleep: async ms => { now += ms; stop.abort() } })
  await queue.run('a', async () => {})
  await assert.rejects(queue.run('a', async () => { writes++ }, { signal: stop.signal }),
    (e: any) => e.notSent === true && e.code === 'automation_stop_requested')
  await queue.run('a', async () => { writes++ }); assert.equal(writes, 1); assert.equal(now, 10_000)
})

test('slow permission check cannot shorten the gap between actual requests', async () => {
  let now = 0; const starts: number[] = []
  const queue = createAccountRequestQueue({ now: () => now, random: () => 0, sleep: async ms => { now += ms } })
  await queue.run('a', async () => { starts.push(now) }, { prepare: async () => { now += 30_000 } })
  await queue.run('a', async () => { starts.push(now) })
  assert.deepEqual(starts, [30_000, 40_000])
})

test('real HTTP clients share the queue across features and bindings; feature queues do not delay other accounts', async () => {
  const f = boundary(), starts: { at: number; url: string }[] = []
  let entered!: () => void, release!: () => void
  const began = new Promise<void>(r => { entered = r }), busy = new Promise<void>(r => { release = r })
  const local = createUnipileRequestScheduler({ sleep: async () => { assert.fail('duplicate feature HTTP timer') } })
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async (url: string) => {
    starts.push({ at: f.now(), url }); if (starts.length === 1) { entered(); await busy }
    return new Response('{}')
  } })
  const secondClient = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async (url: string) => {
    starts.push({ at: f.now(), url }); return new Response('{}')
  } })
  const dispose = installRequestPolicy(createRequestPolicy(f.options))
  const call = (id: string, feature: string, transport = client) => withRequestContext({ taskId: feature, feature },
    () => local.run(() => transport.request('POST', `/${id}/posts`, {})))
  try {
    const first = call('old', 'posts'); await began
    const same = call('new', 'comments', secondClient)
    await call('other', 'withdrawals')
    assert.equal(starts.length, 2); assert.equal(starts[0].at, starts[1].at)
    release(); await Promise.all([first, same])
    assert.equal(starts[2].at - starts[0].at, 10_000)
    assert.match(starts[2].url, /new/)
    assert.deepEqual(f.events.filter(e => e.code === 'request_started').map(e => e.taskId), ['posts', 'withdrawals', 'comments'])
    assert.equal(f.events.filter(e => e.code === 'request_queue_wait').length, 1)
  } finally { release(); dispose() }
})

test('a 429 blocks the already queued request before HTTP and keeps the original absolute deadline', async () => {
  const f = boundary(); let requests = 0
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => {
    requests++; return new Response('{"type":"rate_limit"}', { status: 429, headers: { 'retry-after': '7200' } })
  } })
  const dispose = installRequestPolicy(createRequestPolicy(f.options))
  try {
    const results = await Promise.allSettled([
      client.request('GET', '/old/users/me'), client.request('POST', '/new/posts', {})
    ]) as PromiseRejectedResult[]
    assert.equal(requests, 1)
    assert.equal(results[1].reason.code, 'unipile_shared_cooldown'); assert.equal(results[1].reason.notSent, true)
    const until = results[0].reason.details.retryAt
    assert.equal(f.deadlines.get('same-linkedin-id'), until); assert.equal(results[1].reason.details.retryAt, until)
    assert.equal(f.events.filter(e => e.httpStatus === 429).length, 1)
  } finally { dispose() }
})

test('429 without a provider deadline uses 90 seconds, distinguishes the source and survives policy recreation', async () => {
  const f = boundary(), start = f.now()
  const info: any = { account: 'old', method: 'POST', operation: 'users', requestId: 'limited', write: true }
  const policy = createRequestPolicy(f.options)
  await policy.failed(info, { code: 'unipile_provider_too_many_requests', details: { httpStatus: 429 } })
  assert.equal(f.deadlines.get('same-linkedin-id'), start + 90_000)
  assert.match(f.events.at(-1).message, /срок не указан.*90 секунд/i)
  await f.options.sleep(30_000)
  const restored = createRequestPolicy(f.options)
  await assert.rejects(restored.before({ ...info, account: 'new' }), (error: any) =>
    error.notSent === true && error.details.retryAt === start + 90_000 && error.details.retryAfterMs === 60_000)
  await f.options.sleep(60_000)
  await restored.before({ ...info, account: 'new' })
})

test('an explicit provider deadline is preserved without multiplying or adding our fallback', async () => {
  for (const delay of [30_000, 7200_000]) {
    const f = boundary(), until = f.now() + delay
    await createRequestPolicy(f.options).failed({ account: 'old', method: 'GET', operation: 'users' } as any,
      { code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAt: until } })
    assert.equal(f.deadlines.get('same-linkedin-id'), until)
    assert.doesNotMatch(f.events.at(-1).message, /срок не указан/)
  }
})

test('permission changes during the gap prevent POST; a transport failure stays uncertain without a POST retry', async () => {
  const f = boundary(); let requests = 0, allowed = true
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++; throw new Error('response lost') } })
  const dispose = installRequestPolicy(createRequestPolicy({ ...f.options, sleep: async ms => {
    await f.options.sleep(ms); allowed = false
  } }))
  try {
    await assert.rejects(client.request('POST', '/a/posts', {}), (e: any) => e.code === 'unipile_unreachable' && !e.notSent)
    await assert.rejects(withRequestContext({ assertWrite: async () => { if (!allowed) throw new Error('disabled') } },
      () => client.request('POST', '/a/posts', {})), (e: any) => e.message === 'disabled' && e.notSent === true)
    assert.equal(requests, 1); await drainWrites()
  } finally { dispose() }
})

test('a queue log failure is not an unknown POST and does not hold the next request', async () => {
  const f = boundary(); let requests = 0
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++; return new Response('{}') } })
  const dispose = installRequestPolicy(createRequestPolicy(f.options))
  try {
    await client.request('POST', '/a/posts', {})
    const event = f.store.event; f.store.event = async () => { throw new Error('sql_unavailable') }
    await assert.rejects(client.request('POST', '/a/posts', {}), (e: any) => e.notSent === true)
    assert.equal(requests, 1); f.store.event = event
    await client.request('POST', '/a/posts', {}); assert.equal(requests, 2); await drainWrites()
  } finally { dispose() }
})

test('Stop cancels queued reads and writes; another account can still proceed', async () => {
  const f = boundary(), stop = new AbortController(), methods: string[] = []
  const dispose = installRequestPolicy(createRequestPolicy(f.options))
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async (_url: string, init: any) => {
    methods.push(init.method); return new Response('{}')
  } })
  try {
    stop.abort('disabled')
    await withRequestContext({ signal: stop.signal, taskId: 'stopped-task' }, async () => {
      await assert.rejects(client.request('POST', '/a/posts', {}), (e: any) => e.notSent === true)
      await assert.rejects(client.request('GET', '/a/posts/saved-id'), (e: any) => e.notSent === true)
      await assert.rejects(client.request('GET', '/a/posts/saved-id/comments'), (e: any) => e.notSent === true)
    })
    assert.deepEqual(methods, [])
    await client.request('GET', '/another/posts/saved-id')
    assert.deepEqual(methods, ['GET'])
  } finally { dispose() }
})

test('Stop after permission registration still drains writes without dispatch', async () => {
  const stop = new AbortController(); let requests = 0
  const queue = createAccountRequestQueue()
  const dispose = installRequestPolicy({ before: async () => {}, failed: async () => {},
    queue: (_info: any, _ctx: any, prepare: any, action: any) => queue.run('a', action, {
      signal: stop.signal, prepare: async () => { await prepare(); stop.abort() }
    }) })
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++; return new Response('{}') } })
  try {
    await assert.rejects(client.request('POST', '/a/posts', {}), (e: any) => e.notSent === true)
    assert.equal(requests, 0)
    await Promise.race([drainWrites(), new Promise((_, reject) => {
      const timeout = setTimeout(() => reject(new Error('write drain stuck')), 100); timeout.unref()
    })])
  } finally { dispose() }
})

test('HTTP timeout starts after queue waiting, not while awaiting permission to send', async () => {
  const f = boundary(); let requests = 0
  const dispose = installRequestPolicy(createRequestPolicy({ ...f.options, sleep: async ms => {
    await new Promise(r => setTimeout(r, 15)); await f.options.sleep(ms)
  } }))
  const client = createUnipileHttpClient({ apiKey: 'test', timeoutMs: 1,
    fetchImpl: async (_url: string, init: any) => {
      assert.equal(init.signal.aborted, false); requests++; return new Response('{}')
    } })
  try {
    await client.request('GET', '/a/users/me'); await client.request('GET', '/a/posts')
    assert.equal(requests, 2)
  } finally { dispose() }
})
