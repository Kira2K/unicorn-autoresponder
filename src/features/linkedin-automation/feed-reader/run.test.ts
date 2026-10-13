const { test } = require('node:test') as typeof import('node:test')
const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createFeedRun, stepFeedRun, feedRunSummary, feedRecoveryDeadline } = require('./run.mts') as typeof import('./run.mts')
import type { FeedRun, FeedRunDependencies } from './run.mts'
import type { FeedCard } from '../../../integrations/unipile/home-feed.mts'
const card = (n: number): FeedCard => ({ id: `urn:li:activity:${n}`, text: `Professional post ${n}: a concrete observation`,
  resharedText: '', sponsored: false, canComment: true, canReact: true, reacted: false })
function fixture() {
  let now = 1_800_000_000_000
  let saved: FeedRun = createFeedRun({ id: 'run1', accountId: 'acc_test', ownerId: 'owner', now, excluded: [] })
  const calls = { reads: [] as any[], classified: [] as string[][], likes: [] as string[], comments: [] as string[], checks: [] as string[] }
  const deps: FeedRunDependencies = { now: () => now, random: () => 0.5, assertActive: async () => {},
    save: async value => { saved = structuredClone(value) },
    read: async input => {
      calls.reads.push(input); assert.equal(input.count, 75)
      const start = input.cursor?.start ?? 0, cards = Array.from({ length: input.count! }, (_, i) => card(start + i))
      return { ids: cards.map(c => c.id), cards, rawCount: cards.length, next: { start: start + cards.length, token: 'cursor' } }
    }, model: {
      evaluate: async input => {
        // Fetched data must already survive a restart BEFORE the model is invoked.
        assert.ok(input.posts.every(p => saved.feed.cards!.some(c => c.id === p.id)))
        calls.classified.push(input.posts.map(p => p.id))
        return { assessments: input.posts.map(p => ({ id: p.id, category: 'professional', reason: 'Практический опыт' })) }
      },
      comment: async input => ({ text: 'Does this approach also handle the boundary case?', evidence: input.post.text.slice(0, 20) })
    }, provider: {
      prepare: async post => ({ id: `canonical-${post.id}`, authorId: 'other', text: post.text, canReact: true, canComment: true, reacted: false }),
      like: async id => { calls.likes.push(id); assert.ok(saved.actions.some(a => a.postId === id && a.state === 'sending')) },
      comment: async (id, text) => { calls.comments.push(text); assert.ok(saved.actions.some(a => a.postId === id && a.kind === 'comment' && a.state === 'sending')); return { id: 'comment-1' } },
      verify: async action => { calls.checks.push(action.key); return true }
    } }
  const step = async () => stepFeedRun(structuredClone(saved), deps)
  const advance = (ms: number) => { now += ms }
  const tick = async () => { now = Math.max(now, saved.nextAt ?? 0, saved.phase === 'collecting' ? saved.feed.nextAt ?? 0 : 0); return step() }
  const until = async (predicate: (r: FeedRun) => boolean) => { for (let i = 0; i < 150 && !predicate(saved); i++) await tick(); assert.ok(predicate(saved)) }
  return { deps, calls, step, tick, until, advance, state: () => structuredClone(saved) }
}

test('random portion produces exactly five likes and one grounded comment, no extra feed reads', async () => {
  const f = fixture()
  await f.until(r => r.phase === 'completed')
  assert.equal(f.calls.reads.length, 1); assert.equal(f.calls.classified.length, 4)
  assert.equal(f.calls.likes.length, 5); assert.equal(new Set(f.calls.likes).size, 5)
  assert.equal(f.calls.comments.length, 1); assert.equal(f.calls.checks.length, 6)
  assert.equal(f.state().reason, 'target_reached')
  assert.deepEqual(feedRunSummary(f.state()), { cards: 75, pages: 1, likes: 5, comments: 1, skipped: 0, unconfirmed: 0 })
  await f.step(); assert.equal(f.calls.likes.length, 5); assert.equal(f.calls.comments.length, 1)
})

for (const partial of [false, true]) test(`last verification finishes ${partial ? 'partial' : 'successful'} run before its deadline, without a trailing pause`, async () => {
  const f = fixture()
  if (partial) f.deps.model.comment = async () => ({ text: '', evidence: '' })
  await f.until(r => r.phase === 'acting' &&
    r.actions.filter(a => !['confirmed', 'skipped', 'unknown'].includes(a.state)).length === 1 &&
    r.actions.some(a => a.state === 'ready'))
  // The final send and verification fit before expiry; a pointless final pause would not.
  f.advance(f.state().feed.startedAt + 60 * 60_000 - 100_000 - f.deps.now())
  await f.step()
  assert.ok(f.state().actions.some(a => a.state === 'verifying'))
  await f.tick()
  assert.equal(f.state().phase, 'completed')
  assert.equal(f.state().stage, 'feed_finished')
  assert.equal(f.state().reason, partial ? 'partial_result' : 'target_reached')
  assert.equal(f.calls.likes.length, 5); assert.equal(f.calls.comments.length, partial ? 0 : 1)
  const checks = f.calls.checks.length
  f.advance(120_000); await f.step()
  assert.equal(f.state().phase, 'completed'); assert.equal(f.calls.checks.length, checks)
})

test('read failure immediately stops the managed run and explicit resume retains the portion and deadline', async () => {
  const f = fixture()
  const read = f.deps.read
  f.deps.read = async () => { throw Object.assign(new Error(), { code: 'feed_graphql_error', details: { graphqlDiagnostic: 'errors=1; status=500' } }) }
  await f.step()
  assert.equal(f.state().phase, 'needs_attention', 'do not wait out pacing while hiding a terminal read failure')
  const { createManagedFeedAdapter } = require('./managed.mts') as typeof import('./managed.mts')
  const run = f.state(), logs: string[] = []
  const ctx: any = { task: { id: run.id, account: { id: 123, unipileId: run.accountId, key: `linkedin:${run.ownerId}` }, feed: run, runId: run.id },
    now: f.deps.now, signal: new AbortController().signal, assertWrite: async () => {}, bind: async () => {},
    cooperate: async (fn: () => Promise<any>) => fn(), stage: async (_code: string, text: string) => { logs.push(text) } }
  const adapter = createManagedFeedAdapter({ identity: async () => ({ unipileId: run.accountId, ownerId: run.ownerId }),
    history: async () => [], model: () => f.deps.model, dependencies: () => ({ read, provider: f.deps.provider }), random: () => 0.5 })
  const before = structuredClone(run.feed)
  await adapter.resume!(ctx)
  assert.equal(run.feed.phase, 'waiting')
  assert.equal(run.feed.startedAt, before.startedAt); assert.equal(run.feed.expiresAt, before.expiresAt)
  assert.equal(run.feed.batchSize, before.batchSize); assert.equal(run.feed.batchRemaining, before.batchRemaining)
  assert.equal(run.feed.attempts, 1)
  f.advance(120_000)
  await adapter.step(ctx)
  assert.equal(ctx.task.feed.feed.pages, 1); assert.equal(ctx.task.feed.feed.attempts, 2)
  assert.equal(ctx.task.feed.feed.ids.length, 75)
  assert.equal(f.calls.likes.length, 0)
  // A response lost during a crash cannot be retried this way: unknown Retry-After is retained.
  ctx.task.feed = structuredClone(run); ctx.task.feed.phase = 'needs_attention'
  ctx.task.feed.feed.phase = 'needs_attention'; ctx.task.feed.feed.reason = 'feed_interrupted_read'
  await assert.rejects(adapter.resume!(ctx), { code: 'feed_read_recovery_unsafe' })
})

test('explicit resume can redraft an unsent invalid comment but never reset attempted comments or confirmed likes', async () => {
  const f = fixture()
  f.deps.model.comment = async () => ({ text: 'A useful detailed comment.', evidence: 'invented evidence' })
  await f.until(r => r.phase === 'acting')
  const run = f.state(); run.phase = 'stopped'; run.actions[0].state = 'confirmed'
  const comment = run.actions.find(a => a.kind === 'comment')!
  assert.equal(comment.state, 'skipped'); assert.equal(comment.error, 'feed_comment_invalid')
  const { createManagedFeedAdapter } = require('./managed.mts') as typeof import('./managed.mts')
  const ctx: any = { task: { account: { id: 123 }, feed: run }, now: f.deps.now, stage: async () => {} }
  const adapter = createManagedFeedAdapter({ identity: async () => ({ unipileId: run.accountId, ownerId: run.ownerId }),
    history: async () => [], dependencies: () => ({ read: f.deps.read, provider: f.deps.provider }), model: () => f.deps.model })
  await adapter.resume!(ctx)
  assert.equal(comment.state, 'ready'); assert.equal(comment.error, undefined)
  assert.equal(run.phase, 'preparing'); assert.equal(run.actions[0].state, 'confirmed')
  run.phase = 'stopped'; comment.state = 'unknown'; comment.error = 'feed_comment_invalid'; comment.attemptedAt = f.deps.now()
  await adapter.resume!(ctx)
  assert.equal(comment.state, 'unknown'); assert.equal(run.actions[0].state, 'confirmed')
})
test('insufficient first batch: keeps all cards and assessments across restart, classifies only the new batch', async () => {
  const f = fixture(), evaluate = f.deps.model.evaluate
  f.deps.model.evaluate = async input => {
    const result = await evaluate(input) as any
    result.assessments.forEach((a: any) => { const n = Number(a.id.split(':').at(-1)); if (n > 2 && n < 75) a.category = 'other' })
    return result
  }
  await f.until(r => r.selection !== undefined)
  assert.equal(f.calls.reads.length, 2)
  assert.equal(f.calls.reads[0].count, 75); assert.equal(f.calls.reads[1].cursor.start, 75)
  assert.equal(f.state().feed.cards!.length, 150)
  assert.equal(f.state().assessments.length, 150)
  assert.equal(new Set(f.calls.classified.flat()).size, 150)
  assert.deepEqual(f.state().selection!.likes, ['urn:li:activity:0', 'urn:li:activity:1', 'urn:li:activity:2', 'urn:li:activity:75', 'urn:li:activity:76'])
  const before = JSON.stringify(f.state().feed.cards)
  await f.until(r => r.phase === 'completed')
  assert.equal(JSON.stringify(f.state().feed.cards), before)
})

test('120-card portion is read as 100+20 and classified in saved batches before selection; all calls spaced', async () => {
  const f = fixture(), times: number[] = []
  f.deps.random = () => 0.999999
  f.deps.read = async input => {
    f.calls.reads.push(input); times.push(f.deps.now()); assert.equal(input.count, f.calls.reads.length === 1 ? 100 : 20)
    const start = input.cursor?.start ?? 0
    const cards = Array.from({ length: input.count! }, (_, i) => card(start + i))
    return { ids: cards.map(c => c.id), cards, rawCount: cards.length, next: { start: start + cards.length, token: 'next' } }
  }
  const evaluate = f.deps.model.evaluate
  f.deps.model.evaluate = async input => { assert.ok(input.posts.length <= 20); return evaluate(input) }
  for (const method of ['prepare', 'like', 'comment', 'verify'] as const) {
    const original = f.deps.provider[method] as (...args: any[]) => Promise<any>
    f.deps.provider[method] = async (...args: any[]) => { times.push(f.deps.now()); return original(...args) }
  }
  await f.until(r => r.phase === 'completed')
  assert.equal(f.calls.reads.length, 2); assert.equal(f.calls.classified.length, 6)
  assert.equal(new Set(f.calls.classified.flat()).size, 120)
  assert.equal(f.state().feed.cards!.length, 120)
  assert.equal(f.calls.likes.length, 5); assert.equal(f.calls.comments.length, 1)
  assert.ok(times.every((at, i) => i === 0 || at - times[i - 1] >= 120_000))
})

test('legacy saved fixed-size run continues with count 20', async () => {
  const f = fixture(), legacy = f.state()
  delete legacy.feed.randomPageSize; legacy.feed.count = 20
  f.deps.read = async input => { assert.equal(input.count, 20); return { ids: [], rawCount: 0 } }
  const result = await stepFeedRun(legacy, f.deps)
  assert.equal(result.feed.phase, 'completed')
})

test('classifying and selecting do not bypass the network pause after reading', async () => {
  const f = fixture()
  for (let i = 0; i < 6; i++) await f.step()
  assert.equal(f.state().phase, 'preparing'); assert.equal(f.state().nextAt, f.state().feed.nextAt)
  let prepared = 0
  const prepare = f.deps.provider.prepare
  f.deps.provider.prepare = async c => { prepared++; return prepare(c) }
  await f.step(); assert.equal(prepared, 0)
  f.advance(89_999); await f.step(); assert.equal(prepared, 0)
  f.advance(1); await f.step(); assert.equal(prepared, 1)
})
test('at most four pages; no professional posts produces an honest empty result and no writes', async () => {
  const f = fixture()
  f.deps.model.evaluate = async input => ({ assessments: input.posts.map(p => ({ id: p.id, category: 'advertisement', reason: 'Реклама' })) })
  await f.until(r => r.phase === 'completed')
  assert.equal(f.calls.reads.length, 4); assert.equal(f.state().feed.cards!.length, 300)
  assert.equal(f.calls.likes.length + f.calls.comments.length, 0)
  assert.equal(f.state().reason, 'no_professional_posts')
})
test('intent-save failure prevents POST; failed result-save after POST recovers by verification only', async () => {
  const f = fixture()
  await f.until(r => r.phase === 'acting')
  const save = f.deps.save
  f.deps.save = async () => { throw new Error('disk_full') }
  await assert.rejects(f.step(), /disk_full/); assert.equal(f.calls.likes.length, 0)
  f.deps.save = async state => { if (state.actions[0].state === 'verifying') throw new Error('disk_full'); await save(state) }
  await assert.rejects(f.step(), /disk_full/)
  assert.equal(f.calls.likes.length, 1); assert.equal(f.state().actions[0].state, 'sending')
  f.deps.save = save; f.advance(90_000)
  await f.step(); assert.equal(f.calls.likes.length, 1); assert.equal(f.state().actions[0].state, 'confirmed')
  await f.until(r => r.phase === 'completed'); assert.equal(f.calls.likes.length, 5)
})
test('comment ID survives failed read-back; never sends a replacement comment after 500 or timeout', async () => {
  const f = fixture()
  await f.until(r => r.actions.some(a => a.kind === 'comment' && a.state === 'verifying'))
  assert.equal(f.state().actions.at(-1)!.commentId, 'comment-1')
  f.deps.provider.verify = async action => { assert.equal(action.commentId, 'comment-1'); throw Object.assign(new Error(), { details: { httpStatus: 500 } }) }
  await f.until(r => r.phase === 'completed')
  assert.equal(f.calls.comments.length, 1)
  assert.equal(f.state().actions.at(-1)!.state, 'unknown')
  assert.equal(feedRunSummary(f.state()).unconfirmed, 1)
})
test('Stop during POST preserves result and forbids any later request', async () => {
  const f = fixture(), stop = new AbortController(), like = f.deps.provider.like
  f.deps.signal = stop.signal
  f.deps.provider.like = async id => { await like(id); stop.abort() }
  await f.until(r => r.phase === 'stopped')
  assert.equal(f.calls.likes.length, 1); assert.equal(f.state().actions[0].state, 'verifying')
  await f.step(); assert.equal(f.calls.checks.length, 0); assert.equal(f.calls.likes.length, 1)
})
test('429 retains full absolute deadline and does not fetch or resend while waiting', async () => {
  const f = fixture(); await f.until(r => r.phase === 'acting')
  const until = f.deps.now() + 7_200_000
  f.deps.provider.like = async () => { throw Object.assign(new Error(), { details: { httpStatus: 429, retryAt: until } }) }
  await f.step(); assert.equal(f.state().nextAt, until)
  f.advance(60_000); await f.step(); assert.equal(f.state().nextAt, until)
  assert.equal(f.state().actions[0].state, 'verifying')
})

test('local recovery expiry does not wait for or bypass a longer Retry-After', async () => {
  const f = fixture(); await f.until(r => r.phase === 'acting')
  const began = f.deps.now(), until = began + 7_200_000
  f.deps.provider.like = async id => { f.calls.likes.push(id); throw Object.assign(new Error(), { details: { httpStatus: 429, retryAt: until } }) }
  await f.step()
  assert.equal(feedRecoveryDeadline(f.state()), began + 20 * 60_000)
  f.advance(20 * 60_000); await f.step()
  assert.equal(f.state().actions[0].state, 'unknown'); assert.equal(f.state().nextAt, until)
  assert.equal(feedRecoveryDeadline(f.state()), f.state().feed.startedAt + 60 * 60_000)
  await f.step()
  assert.equal(f.calls.likes.length, 1); assert.equal(f.calls.checks.length, 0)
  f.advance(60 * 60_000); await f.step()
  assert.equal(f.state().phase, 'stopped'); assert.equal(feedRecoveryDeadline(f.state()), undefined)
  assert.equal(f.calls.likes.length, 1)
})

test('prepared current post becomes an ad, or already liked, or own: no mutation for it', async () => {
  for (const change of [{ text: 'Buy now' }, { reacted: true }, { authorId: 'owner' }, { canReact: false }]) {
    const f = fixture(), prepare = f.deps.provider.prepare, evaluate = f.deps.model.evaluate
    f.deps.model.evaluate = async input => input.posts[0]?.text === 'Buy now'
      ? { assessments: [{ id: input.posts[0].id, category: 'advertisement', reason: 'Реклама' }] } : evaluate(input)
    f.deps.provider.prepare = async c => ({ ...await prepare(c), ...(c.id === 'urn:li:activity:0' ? change : {}) })
    await f.until(r => r.phase === 'completed')
    assert.equal(f.calls.likes.length, 4); assert.equal(f.calls.comments.length, 0)
    assert.equal(f.state().reason, 'partial_result')
  }
})
test('unknown send without ID is verified and never resent; further likes continue after twenty minutes', async () => {
  const f = fixture(), like = f.deps.provider.like
  f.deps.provider.like = async id => { await like(id); if (f.calls.likes.length === 1) throw Object.assign(new Error(), { details: { httpStatus: 500 } }) }
  f.deps.provider.verify = async a => a.cardId !== 'urn:li:activity:0'
  await f.until(r => r.phase === 'completed')
  assert.equal(f.calls.likes.length, 5); assert.equal(new Set(f.calls.likes).size, 5)
  assert.equal(feedRunSummary(f.state()).unconfirmed, 1)
  assert.equal(feedRunSummary(f.state()).likes, 4)
})
test('model failure retains all fetched content and does not create a blind network loop', async () => {
  const f = fixture()
  f.deps.model.evaluate = async () => { throw new Error('model_failed') }
  await f.until(r => r.phase === 'needs_attention')
  assert.equal(f.state().feed.cards!.length, 75); assert.equal(f.calls.reads.length, 1)
  await f.step(); assert.equal(f.calls.reads.length, 1); assert.equal(f.calls.likes.length, 0)
})
