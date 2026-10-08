import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { PostError } from '../errors.ts'

async function queued() {
  const f = fixture()
  await f.service.start(203, 'automatic', 'skip-safety'); await f.untilPublished()
  await f.service.action((await f.run()).id, 'start-likes'); await f.step()
  return f
}

test('failed skip checkpoint blocks other likes, releases unused gate and recovers after save', async () => {
  const f = await queued(), put = f.deps.store.put.bind(f.deps.store)
  try {
    f.deps.adapter.identity = async account => {
      if (account.platformAccountId === 901) throw new PostError('post_account_not_ready')
    }
    f.deps.store.put = async () => { throw new Error('offline') }
    await f.step(5000); await f.step(90_001)
    assert.equal(f.counts.like, 0); assert.equal(f.held.size, 0)
    assert.equal((await f.service.get(203)).storageError, true)
    f.deps.store.put = put
    for (let i = 0; i < 20; i++) await f.step(90_001)
    assert.equal(f.counts.like, 5); assert.equal((await f.run()).engagement.items[0].status, 'failed')
  } finally { await f.service.close() }
})

test('Stop after skip still cancels all pending likes', async () => {
  const f = await queued()
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_account_not_ready') }
    await f.step(5000); await f.service.action((await f.run()).id, 'stop')
    for (let i = 0; i < 5; i++) await f.step(90_001)
    assert.equal((await f.run()).engagement.items[0].status, 'failed')
    assert.equal((await f.run()).engagement.status, 'cancelled'); assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})

test('identity mismatch ends the affected actor with its error instead of retrying forever', async () => {
  const f = await queued()
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_identity_mismatch') }
    await f.step(5000); await f.step(90_001)
    assert.equal((await f.run()).engagement.items[0].status, 'failed')
    assert.equal((await f.run()).errorCode, 'post_identity_mismatch'); assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})

for (const failure of [() => new PostError('post_identity_mismatch'),
  () => new PostError('unipile_http_401', undefined, 401)]) {
  test(`permanent ${failure().code} does not poll for two days; other actors finish across restart`, async () => {
    const f = await queued(); let checks = 0
    const identity = f.deps.adapter.identity
    f.deps.adapter.identity = async account => {
      if (account.platformAccountId === 901) { checks++; throw failure() }
      return identity(account)
    }
    try {
      await f.step(5000); f.restart()
      for (let i = 0; i < 576; i++) await f.step(300001)
      const run = await f.run()
      assert.equal(checks, 1); assert.equal(f.counts.like, 5); assert.equal(run.engagement.status, 'partial')
      assert.equal(run.engagement.items[0].errorCode, failure().code)
      assert.equal(run.errorCode, failure().code); assert.equal(run.nextActionAt, undefined)
    } finally { await f.service.close() }
  })
}

test('permanent read-back rejection retains an unknown like without polling or resending', async () => {
  const f = await queued(); let checks = 0
  f.deps.adapter.like = async () => { f.counts.like++; throw new PostError('unipile_timeout') }
  f.deps.adapter.reacted = async () => false
  try {
    await f.step(5000)
    const sent = f.counts.like; assert.equal(sent, 1)
    f.deps.adapter.reacted = async () => { checks++; throw new PostError('unipile_http_403', undefined, 403) }
    for (let i = 0; i < 8; i++) await f.step(300001)
    const reads = checks; f.restart()
    for (let i = 0; i < 20; i++) await f.step(300001)
    const run = await f.run()
    assert.equal(checks, reads); assert.equal(f.counts.like, sent)
    assert.equal(run.engagement.items[0].status, 'uncertain')
    assert.equal(run.engagement.status, 'partial'); assert.equal(run.nextActionAt, undefined)
  } finally { await f.service.close() }
})

for (const disabled of [false, true]) test(`automatic unknown likes stop durably, disabled=${disabled}`, async () => {
  const f = await queued(); let reads = 0
  try {
    const run = await f.run()
    run.automationId = 'completed-post-task'; run.engagement.requestedManually = false
    run.engagement.items = [{ ...run.engagement.items[0], status: 'uncertain', attemptedAt: f.deps.now() }]
    run.engagement.status = 'uncertain'; run.nextActionAt = undefined
    await f.deps.store.put('runs', run.id, run)
    f.deps.adapter.reacted = async () => { reads++; return false }
    f.deps.assertAutomaticLikes = async () => { if (disabled) throw Object.assign(Error(), { code: 'automation_disabled' }) }
    f.restart()
    if (!disabled) { await f.step(); assert.ok(reads > 0) }
    const before = reads
    await f.step(24 * 3600_000); f.restart(); await f.step(24 * 3600_000)
    const after = await f.run()
    assert.equal(reads, before); assert.equal(after.engagement.items[0].status, 'uncertain')
    assert.equal(after.engagement.items[0].verificationStopped, true)
    assert.equal(after.nextActionAt, undefined); assert.equal(after.stop, true)
    assert.equal(f.counts.like, 0)
  } finally { await f.service.close() }
})

test('domain like failures reach the injected journal with author, actor and stage', async () => {
  const f = await queued(), events: any[] = []
  try {
    ;(f.deps as any).reportLikeEvent = (event: any) => events.push(event)
    f.deps.adapter.identity = async () => { throw new PostError('post_identity_mismatch') }
    f.restart(); await f.step(5000)
    assert.equal(events.length, 1)
    assert.equal(events[0].code, 'post_identity_mismatch')
    assert.equal(events[0].authorAccountId, 203); assert.equal(events[0].actorAccountId, 901)
    assert.equal(events[0].stage, 'like_preflight'); assert.equal(events[0].runId, (await f.run()).id)
  } finally { await f.service.close() }
})

test('429 and Retry-After are not converted into skipped accounts', async () => {
  const f = await queued(), identity = f.deps.adapter.identity
  try {
    f.deps.adapter.identity = async () => { throw new PostError('post_account_not_ready', 60_000, 429) }
    await f.step(5000); await f.step(59_999)
    assert.equal((await f.run()).engagement.items[0].status, 'pending'); assert.equal(f.counts.like, 0)
    f.deps.adapter.identity = identity
    await f.step(5000); assert.equal(f.counts.like, 1)
  } finally { await f.service.close() }
})

test('not-ready error after reaction POST stays uncertain, never skips or resends', async () => {
  const f = await queued(), attempts = new Set<number>()
  try {
    f.deps.adapter.like = async account => {
      assert.ok(!attempts.has(account.platformAccountId)); attempts.add(account.platformAccountId)
      f.counts.like++; throw new PostError('post_account_not_ready')
    }
    await f.step(5000)
    assert.equal((await f.run()).engagement.items[0].status, 'uncertain')
    f.restart()
    for (let i = 0; i < 4; i++) await f.step(300_001)
    assert.equal((await f.run()).engagement.status, 'uncertain')
    assert.ok(f.counts.like > 1, 'other actors are allowed to progress')
    assert.equal((await f.run()).engagement.items[0].status, 'uncertain')
  } finally { await f.service.close() }
})
