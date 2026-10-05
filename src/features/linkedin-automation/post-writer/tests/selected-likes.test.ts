import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.ts'
import { defaults } from '../types.ts'
import { createPostAdapter, type PostHttp } from '../../../../integrations/unipile/post-writer-adapter.ts'

test('one unknown like with 500 expires in 20 minutes without blocking other actors or sending twice', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203).slice(0, 2)
  const sent = new Set<string>(), attempts: number[] = []
  f.deps.adapter.reacted = async account => sent.has(account.verifiedProviderId)
  f.deps.adapter.like = async account => {
    attempts.push(account.platformAccountId)
    if (account.platformAccountId === actors[0].platformAccountId) throw Object.assign(Error('server'), {
      code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } })
    sent.add(account.verifiedProviderId)
  }
  try {
    await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: actors.map(a => a.platformAccountId) })
    await f.service.start(203, 'automatic', 'like-budget')
    for (let i = 0; i < 20; i++) await f.step(6000)
    assert.ok(sent.has(actors[1].verifiedProviderId))
    const first = (await f.run()).engagement.items.find(i => i.account.platformAccountId === actors[0].platformAccountId)!.recovery!.firstFailedAt
    f.restart(); f.setNow(first + 20 * 60_000); await f.step()
    const run = await f.run(), item = run.engagement.items.find(i => i.account.platformAccountId === actors[0].platformAccountId)!
    assert.equal(run.engagement.status, 'partial'); assert.equal(item.status, 'uncertain')
    assert.equal(item.recovery?.skippedAt, first + 20 * 60_000)
    assert.equal(attempts.filter(id => id === actors[0].platformAccountId).length, 1)
  } finally { await f.service.close() }
})

for (const fault of ['unknown_post', 'actor_wait', 'reader_wait'] as const)
test(`likes isolate ${fault} across restart while other selected actors finish`, async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203).slice(0, 3)
  const attempts: number[] = [], sent = new Set<string>()
  let release = false, blockedUntil = 0, scans = 0
  const identity = f.deps.adapter.identity
  const unavailable = () => Object.assign(Error('limit'), { code: 'unipile_rate_limit',
    details: { retryAt: blockedUntil, httpStatus: 429 } })
  f.deps.adapter.identity = async account => {
    if (fault === 'actor_wait' && account.platformAccountId === actors[0].platformAccountId && !release) {
      blockedUntil ||= f.deps.now() + 3600_000; throw unavailable()
    }
    await identity(account)
  }
  f.deps.adapter.reactions = async (_reader, _post, ids) => {
    scans++
    if (fault === 'reader_wait' && !release) {
      blockedUntil ||= f.deps.now() + 3600_000; throw unavailable()
    }
    return ids.filter(id => sent.has(id))
  }
  f.deps.adapter.reacted = async actor => sent.has(actor.verifiedProviderId)
  f.deps.adapter.like = async actor => {
    attempts.push(actor.platformAccountId)
    if (fault === 'unknown_post' && actor.platformAccountId === actors[0].platformAccountId)
      throw Object.assign(Error('lost response'), { code: 'unipile_timeout' })
    assert.ok(!sent.has(actor.verifiedProviderId)); sent.add(actor.verifiedProviderId)
  }
  try {
    await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: actors.map(a => a.platformAccountId) })
    await f.service.start(203, 'automatic', `isolated-${fault}`)
    for (let i = 0; i < 30; i++) { await f.step(6000); if (i === 10) f.restart() }
    assert.ok(sent.has(actors[1].verifiedProviderId), 'second actor must not wait for the first failure')
    assert.ok(sent.has(actors[2].verifiedProviderId), 'third actor must not wait for the first failure')
    assert.equal(f.held.size, 0)
    if (fault === 'reader_wait') assert.equal(scans, 1, 'do not retry the blocked batch reader')
    else {
      assert.equal(attempts.filter(id => id === actors[0].platformAccountId).length, fault === 'unknown_post' ? 1 : 0)
      const item = (await f.run()).engagement.items[0]
      assert.equal(item.status, fault === 'unknown_post' ? 'uncertain' : 'pending')
      release = true
      if (fault === 'unknown_post') sent.add(actors[0].verifiedProviderId) // Late receipt, not another POST.
      f.setNow(Math.max(blockedUntil, f.deps.now() + 300_000)); f.restart()
      for (let i = 0; i < 10; i++) await f.step(6000)
    }
    assert.equal((await f.run()).engagement.status, 'completed')
    assert.equal(attempts.filter(id => id === actors[0].platformAccountId).length, 1)
  } finally { await f.service.close() }
})

test('physical mock HTTP comparison: six identical likes cost 30 requests before and 20 after batching', async () => {
  const results: Array<{ requests: number; reads: number; recipients: string[] }> = []
  for (const batch of [false, true]) {
    const f = fixture(), accounts = await f.deps.source.accounts()
    const actors = accounts.filter(a => a.platformAccountId !== 203).slice(0, 6)
    const sent = new Set<string>(); let requests = 0, reads = 0
    await f.service.update(203, { ...defaults(203), likeAccountIds: actors.map(a => a.platformAccountId) })
    await f.service.start(203, 'automatic', 'http-budget'); await f.untilPublished()
    const http: PostHttp = { async request<T>(...[method, path]: Parameters<PostHttp['request']>) {
      requests++
      const account = accounts.find(a => path.includes(a.unipileAccountId))!
      let result: unknown
      if (path.startsWith('/accounts/')) result = { provider: 'LINKEDIN', status: 'running' }
      else if (path.includes('/users/me')) result = { id: account.verifiedProviderId }
      else if (method === 'POST') { assert.ok(!sent.has(account.verifiedProviderId)); sent.add(account.verifiedProviderId); result = { object: 'PostReactionAdded' } }
      else { reads++; result = { data: [...sent].map(id => ({ sender: { id } })), total_count: sent.size } }
      return result as T
    } }
    const adapter = createPostAdapter(() => {}, http, { run: action => action() })
    if (!batch) delete adapter.reactions
    Object.assign(f.deps.adapter, adapter)
    await f.service.action((await f.run()).id, 'start-likes')
    for (let i = 0; i < 40 && (await f.run()).engagement.status !== 'completed'; i++) await f.step(6000)
    assert.equal((await f.run()).engagement.status, 'completed')
    results.push({ requests, reads, recipients: [...sent].sort() }); await f.service.close()
  }
  assert.deepEqual(results.map(r => [r.requests, r.reads]), [[30, 12], [20, 2]])
  assert.deepEqual(results[0].recipients, results[1].recipients)
})

test('six likes use one initial and one final reaction scan, preserving receipts across restart', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203).slice(0, 6)
  const sent = new Set<string>(), scans: number[] = []
  f.deps.adapter.reactions = async (_reader, _post, ids) => { scans.push(sent.size); return ids.filter(id => sent.has(id)) }
  f.deps.adapter.reacted = async () => { throw new Error('individual scan forbidden') }
  f.deps.adapter.like = async actor => { assert.ok(!sent.has(actor.verifiedProviderId)); sent.add(actor.verifiedProviderId) }
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: actors.map(a => a.platformAccountId) })
  await f.service.start(203, 'automatic', 'batch-likes')
  for (let i = 0; i < 30 && sent.size < 2; i++) await f.step(6000)
  assert.equal(sent.size, 2); f.restart()
  for (let i = 0; i < 30 && (await f.run()).engagement.status !== 'completed'; i++) await f.step(6000)
  assert.equal(sent.size, actors.length)
  assert.deepEqual(scans, [0, actors.length])
  assert.equal((await f.run()).engagement.items.filter(i => i.status === 'sent').length, actors.length)
  await f.service.close()
})

test('failed final batch check and Stop never repeat accepted likes', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203).slice(0, 2)
  const sent = new Set<string>(); let fail = true, scans = 0
  f.deps.adapter.reactions = async (_reader, _post, ids) => {
    scans++; if (sent.size && fail) throw new Error('timeout')
    return ids.filter(id => sent.has(id))
  }
  f.deps.adapter.like = async actor => { assert.ok(!sent.has(actor.verifiedProviderId)); sent.add(actor.verifiedProviderId) }
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: actors.map(a => a.platformAccountId) })
  await f.service.start(203, 'automatic', 'batch-recovery')
  for (let i = 0; i < 30 && scans < 2; i++) await f.step(6000)
  assert.equal(sent.size, 2); assert.equal((await f.run()).engagement.status, 'uncertain')
  await f.service.update(203, { ...defaults(203), likes: false }); f.restart(); fail = false
  await f.step(300_000)
  assert.equal(sent.size, 2)
  assert.equal((await f.run()).engagement.items.filter(i => i.status === 'sent').length, 2)
  await f.service.close()
})

test('expired snapshot refreshes before another like and reuses fresh confirmation at the end', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203).slice(0, 2)
  const sent = new Set<string>(); let scans = 0, writes = 0
  f.deps.adapter.reactions = async (_reader, _post, ids) => { scans++; return ids.filter(id => sent.has(id)) }
  f.deps.adapter.like = async actor => { writes++; assert.ok(!sent.has(actor.verifiedProviderId)); sent.add(actor.verifiedProviderId) }
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: actors.map(a => a.platformAccountId) })
  await f.service.start(203, 'automatic', 'expired-reactions')
  for (let i = 0; i < 30 && !writes; i++) await f.step(6000)
  sent.add(actors[1].verifiedProviderId) // The second actor liked manually while this run waited.
  f.restart(); await f.step(300_000); await f.step(6000)
  assert.equal(writes, 1); assert.equal(scans, 2)
  assert.equal((await f.run()).engagement.status, 'completed')
  await f.service.close()
})

test('failed snapshot save forbids the first like, and a lost final receipt joins the batch check', async () => {
  for (const fault of ['save', 'lost_receipt']) {
    const f = fixture(), actor = (await f.deps.source.accounts()).find(a => a.platformAccountId !== 203)!
    let writes = 0, reads = 0, scans = 0
    f.deps.adapter.reactions = async () => { scans++; return writes ? [actor.verifiedProviderId] : [] }
    f.deps.adapter.like = async () => { writes++; throw new Error('response lost') }
    f.deps.adapter.reacted = async () => { reads++; return true }
    if (fault === 'save') {
      const put = f.deps.store.put.bind(f.deps.store)
      f.deps.store.put = async (table, key, value) => {
        if (table === 'runs' && 'engagement' in value && value.engagement.reactionSnapshot) throw new Error('SQL unavailable')
        return put(table, key, value)
      }
    }
    await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: [actor.platformAccountId] })
    await f.service.start(203, 'automatic', `batch-${fault}`)
    for (let i = 0; i < 20; i++) await f.step(6000)
    if (fault === 'save') assert.equal(writes, 0)
    else {
      assert.equal(writes, 1); f.restart(); await f.step(300_000)
      assert.equal(reads, 0); assert.equal(scans, 2); assert.equal(writes, 1)
      assert.equal((await f.run()).engagement.items[0].status, 'sent')
    }
    await f.service.close()
  }
})

test('selected connected actors survive restart; no other account receives a like', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203)
  const selected = actors.slice(0, 2).map(a => a.platformAccountId), sent: number[] = []
  const like = f.deps.adapter.like
  f.deps.adapter.like = async (actor, id) => { sent.push(actor.platformAccountId); await like(actor, id) }
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: selected })
  await f.service.start(203, 'automatic', 'selected-actors')
  await f.untilPublished(); f.restart()
  for (let i = 0; i < 15; i++) await f.step(90_000)
  assert.deepEqual(sent.sort(), selected.sort())
  assert.equal((await f.run()).engagement.status, 'completed')
  await f.service.close()
})

test('unknown, own, duplicate or empty selected actors are rejected without saving', async () => {
  const f = fixture(), actor = (await f.deps.source.accounts()).find(a => a.platformAccountId !== 203)!
  for (const ids of [[999999], [203], [actor.platformAccountId, actor.platformAccountId], []]) {
    await assert.rejects(f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: ids }),
      { code: 'post_like_accounts_invalid' })
  }
  assert.equal((await f.service.get(203)).settings.likes, false)
  await f.service.close()
})

test('removing an actor prevents its next POST; an uncertain like still gets verified', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203)
  const ids = actors.slice(0, 2).map(a => a.platformAccountId)
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: ids })
  await f.service.start(203, 'automatic', 'remove-actor')
  for (let i = 0; i < 12 && !f.counts.like; i++) await f.step(6000)
  const pending = (await f.run()).engagement.items.find(x => x.status === 'sending')!
  assert.ok(pending)
  await f.service.update(203, { ...defaults(203), likes: false, likeAccountIds: [] })
  for (let i = 0; i < 8; i++) await f.step(90_000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).engagement.items.find(x => x.account.platformAccountId === pending.account.platformAccountId)?.status, 'sent')
  await f.service.close()
})

test('manual likes use the saved explicit selection and preserve it when resumed', async () => {
  const f = fixture(), actor = (await f.deps.source.accounts()).find(a => a.platformAccountId !== 203)!
  await f.service.update(203, { ...defaults(203), likeAccountIds: [actor.platformAccountId] })
  await f.service.start(203, 'automatic', 'manual-selected')
  await f.untilPublished()
  await f.service.action((await f.run()).id, 'start-likes')
  const other = (await f.deps.source.accounts()).find(a => a.platformAccountId !== 203 && a.platformAccountId !== actor.platformAccountId)!
  await f.service.update(203, { ...defaults(203), likeAccountIds: [other.platformAccountId] })
  await f.step(); f.restart()
  for (let i = 0; i < 8; i++) await f.step(90_000)
  assert.equal(f.counts.like, 1)
  assert.equal((await f.run()).engagement.items[0].account.platformAccountId, actor.platformAccountId)
  await f.service.close()
})

test('removing just one actor during identity read prevents its POST without disabling other likes', async () => {
  const f = fixture(), actors = (await f.deps.source.accounts()).filter(a => a.platformAccountId !== 203)
  const ids = actors.slice(0, 2).map(a => a.platformAccountId), sent: number[] = []
  let release!: () => void, entered = false
  const held = new Promise<void>(resolve => { release = resolve })
  const identity = f.deps.adapter.identity, like = f.deps.adapter.like
  f.deps.adapter.identity = async account => { if (account.platformAccountId === ids[0]) { entered = true; await held }; await identity(account) }
  f.deps.adapter.like = async (account, post) => { sent.push(account.platformAccountId); await like(account, post) }
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: ids })
  await f.service.start(203, 'automatic', 'remove-one-during-read')
  for (let i = 0; i < 12 && !entered; i++) await f.step(6000)
  assert.equal(entered, true)
  await f.service.update(203, { ...defaults(203), likes: true, likeAccountIds: [ids[1]] })
  release()
  for (let i = 0; i < 10; i++) await f.step(90_000)
  assert.deepEqual(sent, [ids[1]])
  assert.equal((await f.run()).engagement.items[0].status, 'cancelled')
  await f.service.close()
})

test('legacy selection remains compatible; managed schedules cannot restart the old scheduler', async () => {
  const f = fixture()
  await f.service.transferAutomation(203)
  await assert.rejects(f.service.update(203, { ...defaults(203), scheduled: true, days: [1] }),
    { code: 'post_automation_managed' })
  await f.service.update(203, { ...defaults(203), likes: true })
  assert.equal((await f.service.get(203)).settings.likeAccountIds, undefined)
  await f.service.close()
})
