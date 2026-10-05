import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as httpModule from '../../../../integrations/unipile/http-client.ts'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { mockDraft } from '../mock-content.ts'
import { publicationCheckAt } from '../publication.ts'

test('stopped managed publication confirms once after restart without sending again', async () => {
  const f = fixture(), read = f.deps.adapter.read; let reads = 0, available = false
  f.deps.adapter.read = async (...args) => {
    reads++; if (!available) throw Object.assign(Error('offline'), { code: 'unipile_unreachable' }); return read(...args)
  }
  try {
    const run = await f.service.prepareManaged(203, '2026-09-07', 'stop-readback')
    for (let i = 0; i < 5 && !f.counts.publish; i++) await f.service.stepManaged(run.id)
    assert.equal(f.counts.publish, 1)
    const id = (await f.run()).postId
    await f.service.stepManaged(run.id, true); const due = (await f.run()).nextActionAt!
    f.restart(); f.setNow(due - 1); await f.service.stepManaged(run.id); assert.equal(reads, 0)
    available = true; f.setNow(due)
    assert.equal((await f.service.stepManaged(run.id)).status, 'completed')
    await f.service.stepManaged(run.id)
    assert.equal(reads, 1); assert.equal(f.counts.publish, 1); assert.equal((await f.run()).postId, id)
    assert.equal((await f.run()).engagement.status, 'off')
  } finally { await f.service.close() }
})

test('managed publication recovers after a real HTTP 500 contract and restart without repeating POST', async () => {
  const f = fixture(); f.setNow(Date.now())
  const { createUnipileHttpClient } = (httpModule as any).default ?? httpModule
  const send = f.deps.adapter.publish
  let requests = 0, reads = 0
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => {
    requests++; return new Response('{"type":"api/internal_error","req_id":"server-500"}', { status: 500 })
  } })
  f.deps.adapter.publish = async (account, text) => {
    await send(account, text)
    return client.request('POST', '/account/posts', { text })
  }
  const recent = f.deps.adapter.recent
  f.deps.adapter.recent = async account => { reads++; return recent(account) }
  try {
    const run = await f.service.prepareManaged(203, '2026-10-04', 'http-500-calendar')
    await f.service.stepManaged(run.id); await f.service.stepManaged(run.id)
    const pending = await f.run()
    assert.equal(pending.status, 'uncertain'); assert.equal(pending.postId, undefined)
    assert.ok(pending.nextActionAt! >= pending.attemptedAt! + 300_000)
    assert.equal(f.held.size, 0); assert.equal(requests, 1)
    f.restart(); f.setNow(pending.nextActionAt! - 1)
    await f.service.stepManaged(run.id); assert.equal(reads, 0)
    f.setNow(pending.nextActionAt!); await f.service.stepManaged(run.id)
    assert.equal((await f.run()).status, 'published')
    assert.equal(requests, 1); assert.equal(f.counts.publish, 1); assert.equal(reads, 1)
    await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 1)
  } finally { await f.service.close() }
})

test('publication verification intervals grow from the original attempt and respect provider waits', () => {
  const base = 1790000000000, run = { attemptedAt: base } as any
  for (const [age, delay] of [[0, 5 * 60_000], [15 * 60_000, 15 * 60_000],
    [3600_000, 3600_000], [24 * 3600_000, 6 * 3600_000]]) {
    assert.equal(publicationCheckAt(run, base + age), base + age + delay)
    assert.equal(publicationCheckAt(run, base + age, 48 * 3600_000), base + age + 48 * 3600_000)
  }
})

test('old unknown publication checks back off across restart without losing its ID or retry deadline', async t => {
  const f = fixture(); let reads = 0
  await f.service.start(203, 'automatic', 'old-unknown-checks'); await f.step()
  const saved = await f.run(), now = f.deps.now()
  saved.attemptedAt = now - 5 * 86_400_000; saved.nextActionAt = now
  saved.status = 'uncertain'; await f.deps.store.put('runs', saved.id, saved)
  f.deps.adapter.read = async (_account, id) => {
    assert.equal(id, saved.postId); reads++; throw Object.assign(Error('unavailable'), { code: 'unipile_unreachable' })
  }
  f.deps.adapter.recent = async () => { throw Error('Known ID must not scan posts') }
  f.restart()
  for (let i = 0; i < 12; i++) { await f.step(5 * 60_000); if (i === 4) f.restart() }
  t.diagnostic(`old uncertain post in one hour: checks=${reads}`)
  assert.equal(reads, 1); assert.equal(f.counts.publish, 1)
  const pending = await f.run(); assert.equal(pending.status, 'uncertain'); assert.equal(pending.postId, saved.postId)
  f.setNow(pending.nextActionAt!)
  f.deps.adapter.read = async () => { reads++; throw Object.assign(Error('limit'), {
    code: 'unipile_rate_limit', details: { retryAt: f.deps.now() + 24 * 3600_000 } }) }
  await f.step(); assert.equal((await f.run()).nextActionAt, f.deps.now() + 24 * 3600_000)
  assert.equal(f.counts.publish, 1); await f.service.close()
})

test('negative publication readback uses age backoff and can still confirm after Stop', async () => {
  const f = fixture(); let scans = 0
  await f.service.start(203, 'automatic', 'negative-old-check'); await f.step()
  const run = await f.run(); run.postId = undefined; run.status = 'uncertain'
  run.attemptedAt = f.deps.now() - 2 * 86_400_000; run.nextActionAt = f.deps.now()
  await f.deps.store.put('runs', run.id, run)
  f.deps.adapter.recent = async () => { scans++; return [] }; f.restart()
  await f.step(); const next = (await f.run()).nextActionAt!
  assert.equal(next - f.deps.now(), 6 * 3600_000)
  await f.service.action(run.id, 'stop'); f.restart(); await f.step(3600_000); assert.equal(scans, 1)
  f.deps.adapter.recent = async () => [{ id: 'confirmed', authorId: run.target!.verifiedProviderId,
    text: run.draft!.text, createdAt: run.attemptedAt!, url: 'https://linkedin.com/post/confirmed' }]
  f.setNow(next); await f.step()
  assert.equal((await f.run()).status, 'published'); assert.equal(f.counts.publish, 1)
  await f.service.close()
})

test('scheduled publication and reconciliation use background gate priority', async () => {
  const f = fixture(), acquire = f.deps.gate.acquire, kinds: string[] = []
  f.deps.gate.acquire = (kind, id, account) => { kinds.push(kind); return acquire(kind, id, account) }
  const run = await f.service.prepareManaged(203, '2026-09-07', 'scheduled-priority')
  for (let i = 0; i < 5; i++) {
    await f.service.stepManaged(run.id); f.setNow(f.deps.now() + 6000)
  }
  assert.equal((await f.run()).status, 'published'); assert.equal(f.counts.publish, 1)
  assert.deepEqual(kinds, ['post_writer_automatic', 'post_writer_automatic'])
  await f.service.close()
})

test('an uncertain post releases the account throughout Retry-After, including after restart', async () => {
  const f = fixture()
  const read = f.deps.adapter.read
  f.deps.adapter.read = async () => { throw Object.assign(new Error('wait'), { code: 'unipile_rate_limit', details: { retryAfterMs: 3600_000 } }) }
  await f.service.start(203, 'automatic', 'grace-uncertain-post')
  await f.step(); await f.step(6000)
  assert.equal(f.held.size, 0)
  const deadline = (await f.run()).nextActionAt
  f.restart(); await f.service.get(203)
  const release = f.deps.gate.acquire('connection_inviter', 'other-feature', '203')
  await f.step(600_000)
  assert.equal(f.held.size, 1)
  assert.equal((await f.run()).nextActionAt, deadline)
  release(); assert.equal(f.counts.publish, 1)
  f.deps.adapter.read = read
  await f.step(3600_000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1); await f.service.close()
})

test('turning likes off and on never resurrects the saved remaining queue', async () => {
  const f = fixture()
  await f.service.update(203, { ...defaults(203), likes: true })
  await f.service.start(203, 'automatic', 'toggle-pending')
  for (let i = 0; i < 8 && f.counts.like < 1; i++) await f.step(6000)
  assert.equal(f.counts.like, 1)
  await f.service.update(203, { ...defaults(203), likes: false })
  await f.service.update(203, { ...defaults(203), likes: true })
  for (let i = 0; i < 5; i++) await f.step(90_001)
  const run = await f.run()
  assert.equal(f.counts.like, 1)
  assert.equal(run.status, 'published')
  assert.equal(run.engagement.status, 'cancelled')
  assert.equal(run.engagement.items.filter(item => item.status === 'sent').length, 1)
})

test('uncertain like releases its actor while waiting and never repeats POST after restart', async () => {
  const f = fixture()
  const liked: string[] = [], like = f.deps.adapter.like
  f.deps.adapter.like = async (account, postId) => {
    const key = `${account.platformAccountId}:${postId}`; assert.ok(!liked.includes(key)); liked.push(key); await like(account, postId)
  }
  await f.service.update(203, { ...defaults(203), likes: true })
  f.deps.adapter.reacted = async () => false
  await f.service.start(203, 'automatic', 'post-with-pending-like')
  for (let i = 0; i < 8 && !f.counts.like; i++) await f.step(6000)
  await f.step(6000)
  const old = await f.run()
  const actor = old.engagement.items.find(item => item.status === 'uncertain')!
  assert.ok(actor); assert.equal(f.held.size, 0)
  f.restart(); await f.step(86_400_000)
  f.deps.generator.draft = async () => ({ ...mockDraft, text: `Who owns the decision to retry?

I build Go services and review error handling with my team. During that work I keep coming back to one question: does the caller have enough information to decide whether another attempt is safe?

A lost response leaves two possible outcomes. The server may have applied the change, or the request may never have arrived. Those cases look identical from the caller's side. Sending the same operation again can turn a temporary connection problem into a duplicate record.

Before adding another retry, I look for an observable result. A stable identifier or an explicit status read makes the uncertainty visible. The caller can then choose whether to continue, wait, or stop and ask for help.

That choice belongs in the application behavior. A low level transport retry cannot decide whether a business action is safe to repeat. Keeping those responsibilities separate makes a code review much more useful.

Where does your application store the evidence needed for that decision?

#Go #Backend #Reliability #SoftwareEngineering` })
  await f.service.start(203, 'automatic', 'next-day-post')
  await f.untilPublished()
  assert.equal(f.counts.publish, 2, JSON.stringify((await f.service.get(203)).runs.map(run => ({ status: run.status, error: run.errorCode, issues: run.issues }))))
  assert.equal(liked.filter(id => id === `${actor.account.platformAccountId}:${old.postId}`).length, 1)
  assert.ok(liked.filter(id => id.endsWith(`:${old.postId}`)).length > 1, 'other actors continue')
  assert.equal(f.held.size, 0)
  const runs = (await f.service.get(203)).runs
  assert.equal(runs.find(run => run.id === old.id)?.engagement.status, 'uncertain')
})

test('Stop while identity is reading prevents the publication POST', async () => {
  const f = fixture()
  const run = await f.service.start(203, 'automatic', 'stop-identity')
  f.deps.adapter.identity = async () => { await f.service.action(run.id, 'stop') }
  await f.step()
  assert.equal(f.counts.publish, 0)
  assert.equal((await f.run()).status, 'stopped')
  assert.equal(f.held.size, 0)
})

test('loss of executor ownership before POST preserves a resumable draft', async () => {
  const f = fixture(), acquire = f.deps.gate.acquire
  const run = await f.service.prepareManaged(203, '2026-09-07', 'recover-owner')
  await f.service.stepManaged(run.id)
  f.deps.gate.acquire = () => { throw Object.assign(new Error('lost'), { code: 'automation_owner_lost' }) }
  await assert.rejects(f.service.stepManaged(run.id), { code: 'automation_owner_lost' })
  assert.equal((await f.run()).status, 'ready'); assert.equal(f.counts.publish, 0)
  f.deps.gate.acquire = acquire
  await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 1); await f.service.close()
})

test('failed history confirmation cannot mark post published; recovery never repeats POST', async () => {
  const f = fixture()
  const put = f.deps.store.put.bind(f.deps.store)
  f.deps.store.put = async (table, key, value) => {
    if (table === 'history' && 'status' in value && value.status === 'published') throw new Error('Noco failed')
    await put(table, key, value)
  }
  await f.service.start(203, 'automatic', 'history-persistence')
  await f.step()
  await f.step(6000)
  assert.equal((await f.run()).status, 'uncertain')
  f.deps.store.put = put
  f.restart()
  await f.step(300_000)
  assert.equal((await f.run()).status, 'published')
  assert.equal(f.counts.publish, 1)
})

test('full Retry-After reaches every client; no-cache remains opt-in', async () => {
  const { createUnipileHttpClient } = httpModule as unknown as {
    createUnipileHttpClient(options: Record<string, unknown>): {
      request(method: string, path: string, body?: unknown, options?: Record<string, boolean>): Promise<unknown> }
  }
  for (const full of [false, true]) {
    const client = createUnipileHttpClient({ apiKey: 'mock', baseUrl: 'http://mock',
      fetchImpl: async (_url: string, init: RequestInit) => {
        assert.equal((init.headers as Record<string, string>)['Cache-Control'], full ? 'no-cache' : undefined)
        return new Response('{}', { status: 429, headers: { 'Retry-After': '3600' } })
      } })
    await assert.rejects(client.request('GET', '/profile', undefined, { fullRetryAfter: full, noCache: full }), (error: unknown) => {
      assert.equal((error as { details: { retryAfterMs: number } }).details.retryAfterMs, 3_600_000)
      return true
    })
  }
})
