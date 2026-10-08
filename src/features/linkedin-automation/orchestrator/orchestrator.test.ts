import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOrchestrator } from './service.ts'
import { describeFailure } from './failure.ts'
import { plan, windowFor, reserve, validateSchedule, canRunBesideUnknown, dateMsk } from './planner.ts'
import { accountKey, fail, type Schedule, type Store, type Task, type Event, type Adapters, type Cooldown } from './contracts.ts'
import { createRequestPolicy } from './request-policy.ts'
import * as httpModule from '../../../integrations/unipile/http-client.ts'
import * as controlModule from '../../../integrations/unipile/request-control.ts'
import { prepareLinkedInAutomation } from '../../web-console/backend/linkedin-automation.ts'
import express from 'express'
import { createFeatureAdapters } from './adapters.ts'
import { createConnectionInviterService } from '../connection-inviter/service.ts'
import { fixture as inviterFixture } from '../connection-inviter/tests/fixtures.ts'
import { createInvitationWithdrawal } from '../invitation-withdrawal/service.ts'
import { fixture as withdrawalFixture } from '../invitation-withdrawal/test-fixture.ts'
import { createPostWriterService } from '../post-writer/service.ts'
import { createMockDependencies } from '../post-writer/mock.ts'
import * as commentsModule from '../comment-monitor/service.ts'
import { readAllSentInvitations } from '../../../integrations/unipile/sent-invitations.ts'
const { createUnipileHttpClient } = (httpModule as any).default ?? httpModule
const { installRequestPolicy, withRequestContext, requestInfo } = (controlModule as any).default ?? controlModule

const noon = Date.parse('2026-09-28T12:00:00+03:00')

test('failed error checkpoint survives SQL recovery with task attribution and no secret values', async () => {
  const f = fixture(), reports: Event[] = []; f.schedules.push(schedule(1, ['posts']))
  let failSaves = false, steps = 0
  const save = f.store.save
  f.store.save = async (...args) => { if (failSaves) throw Object.assign(Error('password=PRIVATE'), { code: 'sql_unavailable' }); return save(...args) }
  f.adapters.posts.step = async ctx => {
    steps++; await ctx.bind('saved-post'); await ctx.stage?.('post_read', 'Проверка поста')
    failSaves = true; throw Object.assign(Error('private response'), { code: 'unipile_http_500', details: { httpStatus: 500 } })
  }
  const engine = createOrchestrator({ store: f.store, adapters: f.adapters, now: f.now, random: () => 0,
    autoStart: false, owner: 'test', report: event => reports.push(clone(event)) })
  try {
    await engine.tick(); await engine.idle()
    assert.equal((await engine.status()).error?.code, 'sql_unavailable')
    assert.ok(reports.some(event => event.code === 'unipile_http_500'))
    const sql = reports.find(event => event.code === 'sql_unavailable')!
    assert.equal(sql.accountId, 1); assert.equal(sql.studentId, 101); assert.equal(sql.feature, 'posts')
    assert.equal(sql.runId, 'saved-post'); assert.equal(sql.operation, 'post_read')
    assert.doesNotMatch(JSON.stringify(reports), /PRIVATE|private response/)
    const event = f.store.event
    f.store.event = async () => { throw fail('sql_unavailable') }
    await engine.tick(); await engine.idle(); assert.equal(steps, 1)
    f.store.event = event; failSaves = false
    f.adapters.posts.step = async () => { steps++; return { status: 'completed' } }
    await engine.tick(); await engine.idle()
    assert.ok(f.events.some(event => event.code === 'unipile_http_500' && event.runId === 'saved-post'))
    assert.equal(f.events.filter(event => event.code === 'sql_unavailable' && event.runId === 'saved-post').length, 1)
    assert.equal((await engine.status()).error, undefined)
    const count = f.events.filter(event => event.code === 'sql_unavailable').length
    await engine.tick(); await engine.idle()
    assert.equal(f.events.filter(event => event.code === 'sql_unavailable').length, count)
  } finally { await engine.close() }
})

test('stopped verification is terminal across restart, regardless of its old timer', async () => {
  const f = fixture(), s = schedule(), task = plan(s, [], noon, () => 0)[0]
  Object.assign(task, { stopped: true, stopApplied: true, state: 'verifying', runId: 'old',
    nextAt: noon + 86400_000, startedAt: noon - 86400_000, deadlineAt: noon - 1 })
  f.tasks.push(task); f.schedules.push(s)
  let steps = 0, stops = 0
  f.adapters.invitations.step = async () => { steps++; return { status: 'completed' } }
  f.adapters.invitations.stop = async () => { stops++; return { status: 'stopped', summary: { completed: 0, skipped: 0, unconfirmed: 1 } } }
  let engine = f.create()
  await engine.tick(); await engine.idle()
  assert.equal(f.tasks[0].state, 'stopped'); assert.equal(stops, 1); assert.equal(steps, 0)
  assert.equal(f.tasks[0].summary?.unconfirmed, 1)
  await engine.close(); engine = f.create('restart'); f.advance(2 * 86400_000)
  await engine.tick(); await engine.idle()
  assert.equal(stops, 1); assert.equal(steps, 0); await engine.close()
})

test('disabling and re-enabling unchanged future slots preserves their random planned times', async () => {
  const f = fixture(), s = schedule(1, ['posts', 'invitations', 'comments', 'withdrawals'])
  s.slots[0].start = 18 * 60; s.slots[0].end = 21 * 60
  f.schedules.push(s)
  const planned = plan(s, [], noon, () => .73); f.tasks.push(...planned)
  const before = new Map(planned.map(task => [task.id, task.plannedAt]))
  const engine = f.create(); await engine.tick(); await engine.idle()
  const paused = await engine.saveSchedule({ ...s, enabled: false }, 1)
  await engine.tick(); await engine.idle()
  await engine.saveSchedule({ ...paused, enabled: true }, paused.version)
  for (const task of f.tasks) { assert.equal(task.plannedAt, before.get(task.id)); assert.equal(task.state, 'planned') }
  await engine.close()
})

test('API 429 belongs to one normalized route; provider and unknown limits remain account-wide', async () => {
  for (const type of ['api/too_many_requests', 'provider/too_many_requests', 'unknown']) {
    const f = fixture(), options = { store: f.store, now: f.now, resolveKey: () => 'linkedin:1', assertOwner: async () => {}, onFailure() {} }
    let p = createRequestPolicy(options)
    const info = requestInfo('GET', '/u1/users/me/posts?limit=100&cursor=secret')
    const error = { code: `unipile_${type.replaceAll('/', '_')}`, details: { httpStatus: 429, errorType: type,
      retryAt: noon + 86400_000, observedAt: noon } }
    await p.failed(info, error); f.advance(60_000); await p.failed(info, error)
    p = createRequestPolicy(options)
    assert.equal(f.cooldowns[0].until, noon + 86400_000)
    await assert.rejects(p.before(requestInfo('GET', '/u2/users/person/posts?limit=20')))
    const other = requestInfo('GET', '/u2/users/me/relation-requests')
    if (type.startsWith('api/')) { await p.before(other); assert.notEqual(f.cooldowns[0].method, '*') }
    else { await assert.rejects(p.before(other)); assert.equal(f.cooldowns[0].method, '*') }
    assert.ok(!JSON.stringify(f.cooldowns).includes('secret'))
  }
})

test('Stop adapters are fenced from GET as well as POST, before any provider request', async () => {
  const f = fixture(), p = createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {}, onFailure() {} })
  const dispose = installRequestPolicy(p); let sent = 0
  const client = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => { sent++; return new Response('{}') } })
  const stop = async () => { await client.request('GET', '/u1/users/me/posts'); return { status: 'stopped' } }
  const adapters = createFeatureAdapters({ inviter: { stepManaged: stop, withdrawals: { startAutomatic() {}, stepManaged: stop } },
    posts: { stepManaged: stop }, comments: { stepManaged: stop } } as any)
  try {
    for (const feature of ['posts', 'invitations', 'comments', 'withdrawals'] as const) {
      const task = { ...plan(schedule(1, [feature]), [], noon, () => 0)[0], runId: 'stopped', stopped: true }
      await assert.rejects(adapters[feature].stop({ task, now: f.now, signal: new AbortController().signal,
        assertWrite: async () => {}, bind: async () => {}, cooperate: async action => action() }), { notSent: true })
    }
    assert.equal(sent, 0)
  } finally { dispose() }
})

test('preparation 500 expires across restart; dependent comments are skipped and independent work finishes', async () => {
  const f = fixture(); f.schedules.push(schedule(1, ['posts', 'comments', 'invitations']))
  f.tasks.push(...plan(f.schedules[0], [], f.now(), () => 0).map(task => ({ ...task, plannedAt: noon, nextAt: noon })))
  let calls = 0
  f.adapters.posts.step = async ctx => {
    calls++; await ctx.stage?.('post_prepare', 'Подготовка публикации')
    throw Object.assign(Error('server'), { code: 'unipile_http_500', details: { httpStatus: 500, retryAt: f.now() + 7200_000 } })
  }
  let engine = f.create()
  await engine.tick(); await engine.idle()
  const first = f.tasks.find(task => task.feature === 'posts')!.preparationRecovery!.firstFailedAt
  await engine.close(); engine = f.create('restart')
  f.advance(20 * 60_000)
  for (let i = 0; i < 4; i++) { await engine.tick(); await engine.idle(); f.advance(20_000) }
  assert.equal(calls, 1)
  assert.equal(f.tasks.find(task => task.feature === 'posts')!.preparationRecovery!.firstFailedAt, first)
  assert.equal(f.tasks.find(task => task.feature === 'posts')!.reason, 'unipile_action_skipped')
  assert.equal(f.tasks.find(task => task.feature === 'comments')!.reason, 'comments_post_skipped')
  assert.equal(f.tasks.find(task => task.feature === 'invitations')!.state, 'completed')
  await engine.close()
})

test('local expiry runs at 20 minutes under a longer cooldown; log identifies student, action, stage and original request', async () => {
  const f = fixture(); f.schedules.push(schedule(1, ['posts']))
  let steps = 0
  f.adapters.posts.step = async ctx => {
    if (++steps === 1) { await ctx.bind('saved-post'); return { status: 'verifying',
      nextActionAt: new Date(noon + 7200_000).toISOString(), recoveryDeadlineAt: noon + 20 * 60_000 } }
    return { status: 'completed', reason: 'unipile_action_skipped',
      summary: { completed: 0, skipped: 0, unconfirmed: 1 }, skippedActions: [{ actionId: 'post:saved-post',
        stage: 'posts_read', httpStatus: 500, errorCode: 'unipile_api_internal_error', requestId: 'Remote-AbC_42' }] }
  }
  const engine = f.create(); await engine.tick(); await engine.idle()
  f.cooldowns.push({ account: 'linkedin:1', method: '*', observedAt: noon, until: noon + 7200_000, code: 'unipile_http_500' })
  f.advance(20 * 60_000); await engine.tick(); await engine.idle()
  assert.equal(steps, 2); assert.equal(f.tasks[0].state, 'completed')
  const error = f.events.find(e => e.actionId === 'post:saved-post')!
  assert.equal(error.accountId, 1); assert.equal(error.studentId, 101); assert.equal(error.feature, 'posts')
  assert.equal(error.source, 'Unipile'); assert.equal(error.httpStatus, 500); assert.equal(error.operation, 'posts_read')
  assert.equal(error.requestId, 'Remote-AbC_42'); assert.match(error.message, /20 минут/)
  assert.ok(f.events.some(e => /Выполнено: 0; пропущено: 0; не подтверждено: 1/.test(e.message)))
  const policy = createRequestPolicy({ store: f.store, now: f.now, resolveKey: () => 'linkedin:1', assertOwner: async () => {}, onFailure() {} })
  await assert.rejects(policy.before({ account: 'u1', method: 'GET', operation: 'posts', write: false }), { notSent: true })
  assert.equal(f.cooldowns.find(c => c.method === '*')!.until, noon + 7200_000)
  await engine.close()
})

test('bad withdrawal page retries after a saved pause, survives restart and never masquerades as HTTP 500', async () => {
  const f = fixture(); f.schedules.push(schedule(1, ['withdrawals']), schedule(2, ['invitations']))
  let reads = 0
  f.adapters.withdrawals.step = async () => {
    await readAllSentInvitations(async () => ++reads === 1 ? { data: [{ id: '', type: 'sent' }] } : { data: [] })
    return { status: 'completed' }
  }
  let c = f.create(); await c.tick(); await c.idle()
  assert.equal(f.tasks.find(t => t.account.id === 1)?.state, 'waiting')
  assert.equal(f.tasks.find(t => t.account.id === 2)?.state, 'completed')
  const event = f.events.find(e => e.code === 'withdrawal_list_invalid')!
  assert.equal(event.source, 'Unipile'); assert.equal(event.httpStatus, undefined)
  assert.match(event.diagnostic!, /invalid_id/); assert.match(event.diagnostic!, /page=1/)
  await c.close(); c = f.create('restarted')
  await c.tick(); await c.idle(); assert.equal(reads, 1)
  f.advance(60_000); await c.tick(); await c.idle()
  assert.equal(f.tasks.find(t => t.account.id === 1)?.state, 'completed')
  assert.equal(reads, 2); await c.close()
})
test('last permission rejection is logged as not sent and never counted as a physical request', async () => {
  const f = fixture(); let requests = 0, permissions = 0
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now, version: 'test-version',
    assertOwner: async () => { if (++permissions === 2) throw fail('automation_owner_lost') }, onFailure() {} }))
  const client = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => { requests++; return new Response('{}') } })
  try {
    await assert.rejects(withRequestContext({ taskId: 'task', runId: 'run', actionId: 'action', feature: 'posts', initiator: 'schedule' },
      () => client.request('POST', '/posts', { account_id: 'u' })), (e: any) => e.notSent === true)
    assert.equal(requests, 0)
    assert.deepEqual(f.events.map(e => e.code), ['request_prepared', 'request_not_sent'])
    for (const event of f.events) {
      assert.equal(event.runId, 'run'); assert.equal(event.actionId, 'action'); assert.equal(event.version, 'test-version')
    }
  } finally { dispose() }
})

test('dispatch audit failure preserves an in-flight POST outcome and drains it before shutdown', async () => {
  const f = fixture(); let release!: () => void, failure = 0, requests = 0
  const pending = new Promise<void>(resolve => { release = resolve }), event = f.store.event
  f.store.event = async e => { if (e.code === 'request_started') throw fail('sql_unavailable'); return event(e) }
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now,
    assertOwner: async () => {}, onFailure() { failure++ } }))
  const client = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => {
    requests++; await pending; return new Response('{"id":"saved-id"}')
  } })
  try {
    const result = client.request('POST', '/posts', { account_id: 'u' })
    for (let i = 0; i < 12 && !requests; i++) await new Promise(resolve => setImmediate(resolve))
    let drained = false
    const drain = ((controlModule as any).default ?? controlModule).drainWrites().then(() => { drained = true })
    await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false)
    release(); assert.deepEqual(await result, { id: 'saved-id' }); await drain
    assert.equal(requests, 1); assert.equal(failure, 1); assert.equal(drained, true)
  } finally { release(); dispose() }
})

for (const status of [200, 429]) test(`audit outage after HTTP ${status} preserves provider outcome and fences the next POST`, async () => {
  const f = fixture(); let unavailable = false, requests = 0
  const event = f.store.event, cooldown = f.store.cooldown
  f.store.event = async value => { if (value.code === 'request_succeeded') throw fail('sql_unavailable'); return event(value) }
  f.store.cooldown = async value => { if (status === 429) throw fail('sql_unavailable'); return cooldown(value) }
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now,
    sleep: async ms => f.advance(ms), assertOwner: async () => { if (unavailable) throw fail('automation_owner_lost') },
    onFailure() { unavailable = true } }))
  const client = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => {
    requests++; return new Response(status === 200 ? '{"id":"known-post"}' : '{"type":"rate_limit"}',
      { status, headers: { 'Retry-After': '7200' } })
  } })
  try {
    if (status === 200) assert.deepEqual(await client.request('POST', '/posts', { account_id: 'u' }), { id: 'known-post' })
    else await assert.rejects(client.request('POST', '/posts', { account_id: 'u' }), (error: any) =>
      error.code === 'unipile_rate_limit' && error.details.retryAfterMs === 7200_000 &&
      error.details.retryAt === error.details.observedAt + 7200_000)
    assert.equal(unavailable, true)
    await assert.rejects(client.request('POST', '/posts', { account_id: 'u' }), (error: any) => error.notSent === true)
    assert.equal(requests, 1)
  } finally { dispose() }
})

test('missed unstarted work cannot catch up in another day or another slot', async () => {
  for (const laterDay of [false, true]) {
    const f = fixture(), s = schedule(1, ['posts'])
    s.slots = [{ id: 'early', day: 0, start: 720, end: 721, features: ['posts'] },
      { id: 'later', day: laterDay ? 1 : 0, start: laterDay ? 720 : 780, end: 840, features: ['posts'] }]
    f.schedules.push(s); f.tasks.push(...plan(s, [], f.now(), () => 0))
    const oldId = f.tasks[0].id, started: string[] = []
    f.advance(laterDay ? 86400_000 : 3600_000)
    f.adapters.posts.step = async ctx => { started.push(ctx.task.id); return { status: 'completed' } }
    const engine = f.create()
    try { for (let i = 0; i < 3; i++) { await engine.tick(); await engine.idle(); f.advance(20_000) }
      assert.ok(!started.includes(oldId)); assert.equal(f.tasks.find(t => t.id === oldId)?.reason, 'automation_window_missed')
      assert.equal(started.length, laterDay ? 1 : 0)
    } finally { await engine.close() }
  }
})

test('expired verification stops new work once, then respects the saved deadline', async () => {
  const f = fixture(), s = schedule(), task = plan(s, [], f.now(), () => 0)[0]
  Object.assign(task, { state: 'verifying', runId: 'old', startedAt: noon - 86400_001,
    deadlineAt: noon - 1, nextAt: noon + 7200_000 })
  f.schedules.push(s); f.tasks.push(task); let calls = 0
  f.adapters.invitations.stop = async () => { calls++; return { status: 'verifying', nextActionAt: new Date(noon + 7200_000).toISOString() } }
  const engine = f.create()
  try { for (let i = 0; i < 12; i++) { await engine.tick(); await engine.idle(); f.advance(5000) }
    assert.equal(calls, 1); assert.equal(f.tasks[0].nextAt, noon + 7200_000)
  } finally { await engine.close() }
})

test('legacy stopped runs receive local cleanup once and never regain read-back ownership', async () => {
  const f = fixture(), s = schedule(1, ['posts']), task = plan(s, [], f.now(), () => 0)[0]
  Object.assign(task, { state: 'stopped', runId: 'saved-post', stopped: true, startedAt: noon - 86400_001,
    deadlineAt: noon - 1, nextAt: noon + 60_000, day: '2026-09-27' })
  s.enabled = false; f.schedules.push(s); f.tasks.push(task); let checks = 0
  f.adapters.posts.step = async () => { throw Error('new writes forbidden') }
  f.adapters.posts.stop = async () => { checks++; return checks === 1 ? { status: 'verifying',
    nextActionAt: new Date(noon + 60_000).toISOString() } : { status: 'stopped' } }
  await f.store.cooldown({ account: task.account.key, method: '*', until: noon + 7200_000, observedAt: noon, code: 'unipile_rate_limit' })
  let engine = f.create()
  try {
    await engine.tick(); await engine.idle(); assert.equal(checks, 1); assert.equal(f.tasks[0].stopApplied, true)
    await engine.close(); engine = f.create(); f.advance(3600_000)
    for (let i = 0; i < 12; i++) { await engine.tick(); await engine.idle(); f.advance(5000) }
    assert.equal(checks, 1)
    f.advance(noon + 7200_000 - f.now()); await engine.tick(); await engine.idle(); assert.equal(checks, 1)
    f.advance(30_000); await engine.tick(); await engine.idle(); assert.equal(checks, 1)
    assert.equal(f.tasks[0].state, 'stopped')
  } finally { await engine.close() }
})

test('status exposes provider wait without rewriting the saved plan or adding polling events', async () => {
  const f = fixture(), s = schedule(); f.schedules.push(s)
  f.tasks.push(...plan(s, [], f.now(), () => 0))
  await f.store.cooldown({ account: s.account.key, method: '*', code: 'unipile_rate_limit', observedAt: noon, until: noon + 7200_000 })
  const engine = f.create()
  try { await engine.tick(); const count = f.events.length
    for (let i = 0; i < 3; i++) {
      const status = await engine.status(), task = status.tasks[0] as any
      assert.equal(task.waitReason, 'unipile_shared_cooldown'); assert.equal(task.effectiveNextAt, noon + 7200_000)
      assert.equal(task.plannedAt, noon); assert.equal(f.tasks[0].nextAt, noon)
    }
    assert.equal(f.events.length, count)
  } finally { await engine.close() }
})

test('comment restoration retries a transient SQL failure and becomes available without restart', async () => {
  let time = noon, reads = 0
  const service = ((commentsModule as any).default ?? commentsModule).createCommentMonitorService({ autoStart: false,
    now: () => time, repository: {}, adapter: {}, openai: {}, loggerFor: () => ({ event() {} }),
    store: { async list() { if (++reads === 1) throw fail('sql_unavailable'); return [] }, async purge() {} } })
  try { await service.tick(); assert.equal(reads, 1)
    for (let i = 0; i < 5; i++) await service.tick()
    assert.equal(reads, 1, 'no tight retry loop')
    time += 60_000; await service.tick(); assert.equal(reads, 2)
    await assert.rejects(service.stepManaged('missing'), { code: 'comment_managed_job_missing' })
  } finally { service.stop() }
})

test('an old pending reply does not block the next daily owner of its session', () => {
  const s = schedule(1, ['comments']), pending = plan(s, [], noon, () => 0)[0]
  pending.state = 'verifying'; pending.runId = 'session'
  assert.equal(canRunBesideUnknown({ ...pending, id: 'tomorrow', day: '2026-09-29' }, pending, noon), true)
  assert.equal(canRunBesideUnknown({ ...pending, id: 'duplicate' }, pending, noon), false)
})

test('next daily comment task takes the real saved session; the old task retires without duplicate polling', async () => {
  const f = fixture(), s = schedule(1, ['comments']); s.slots.push({ ...s.slots[0], id: 'tuesday', day: 1 })
  const old = plan(s, [], f.now(), () => 0)[0], records = new Map<string, any>(); let reads = 0
  const comments = ((commentsModule as any).default ?? commentsModule).createCommentMonitorService({ autoStart: false, now: f.now,
    loggerFor: () => ({ event() {} }), repository: { async listAccounts() { return [{ platformAccountId: 1,
      unipileAccountId: 'u1', unipileAccountStatus: 'running', lastVerifiedAt: 'yes', verifiedProviderId: 'p1' }] } },
    store: { async list() { return clone([...records.values()]) }, async create(j: any) { records.set(j.jobId, clone(j)) },
      async update(j: any) { records.set(j.jobId, clone(j)) }, async purge() {} },
    adapter: { async getAccount() { return { user_id: 'p1' } }, async listPosts() { return { items: [{ id: 'p', text: 'Go' }] } },
      async listReplies() { reads++; return { items: [{ id: 'reply', is_sender: true }] } } }, openai: {} })
  const job = await comments.prepareManaged(1, 'automation:linkedin:1'); comments.stop()
  const saved = records.get(job.jobId), due = f.now() + 86400_000 + 7200_000
  saved.state.items = [{ status: 'uncertain', replyId: 'reply', postId: 'p', parentId: 'parent', threadId: 'thread',
    nextVerificationAt: new Date(due).toISOString() }]; saved.nextCheckAt = new Date(due).toISOString()
  const restored = ((commentsModule as any).default ?? commentsModule).createCommentMonitorService({ autoStart: false, now: f.now,
    loggerFor: () => ({ event() {} }), store: { async list() { return clone([...records.values()]) },
      async update(j: any) { records.set(j.jobId, clone(j)) }, async purge() {} }, repository: {}, adapter: {}, openai: {} })
  Object.assign(old, { state: 'verifying', runId: job.jobId, startedAt: f.now(), nextAt: due, deadlineAt: due + 3600_000 })
  f.tasks.push(old); f.schedules.push(s); f.advance(86400_000)
  f.adapters.comments = createFeatureAdapters({ posts: { async get() { return { runs: [] } } }, comments: restored } as any).comments
  const engine = f.create()
  try {
    await engine.tick(); await engine.idle(); f.advance(20_000); await engine.tick(); await engine.idle()
    const newer = f.tasks.find(t => t.day > old.day)!
    assert.equal(newer.runId, job.jobId); assert.equal(newer.state, 'verifying'); assert.equal(newer.nextAt, due)
    assert.equal(f.tasks.find(t => t.id === old.id)?.reason, 'session_continued')
    assert.equal(records.size, 1); assert.equal(records.get(job.jobId).state.items[0].replyId, 'reply'); assert.equal(reads, 0)
  } finally { restored.stop(); await engine.close() }
})
test('failure presentation preserves source and status precedence without raw messages', () => {
  const cases = [
    { error: { code: 'unipile_storage_failed', status: 500 }, source: 'SQL', status: 500 },
    { error: { code: 'unipile_api_too_many_requests', details: { httpStatus: 429 }, status: 500 }, source: 'Unipile', status: 429 },
    { error: { code: 'dolphin_unavailable', httpStatus: 503 }, source: 'Dolphin', status: 503 },
    { error: { code: 'openai_timeout' }, source: 'OpenAI', status: undefined },
  ]
  for (const { error, source, status } of cases) {
    const result = describeFailure({ ...error, message: 'private raw response' })
    assert.equal(result.code, error.code)
    assert.equal(result.source, source)
    assert.equal(result.httpStatus, status)
    assert.doesNotMatch(JSON.stringify(result), /private raw response/)
  }
  for (const error of [undefined, null, false, 'private raw response']) {
    const result = describeFailure(error)
    assert.equal(result.code, 'automation_internal_error')
    assert.equal(result.source, 'наш код')
    assert.doesNotMatch(JSON.stringify(result), /private raw response/)
  }
})

test('generic error preserves code and source location without provider payloads or secrets', () => {
  const error = Object.assign(new TypeError('password=secret https://user:pass@host/private'), {
    cause: Object.assign(new Error('SELECT secret FROM private'), { code: 'ECONNRESET' }) })
  error.stack = 'TypeError: secret\n    at step (D:/repo/src/features/linkedin-automation/orchestrator/service.ts:77:4)'
  const result = describeFailure(error)
  assert.equal(result.code, 'automation_internal_error')
  assert.match(result.diagnostic!, /TypeError.*service.ts:77:4/)
  assert.match(result.diagnostic!, /ECONNRESET/)
  assert.doesNotMatch(JSON.stringify(result), /password|secret|SELECT|user:pass|private/)
})
const clone = <T>(v: T): T => structuredClone(v)
const schedule = (id = 1, features: Schedule['slots'][number]['features'] = ['invitations']): Schedule => ({
  account: { id, studentId: id + 100, name: `Ученик ${id}`, key: `linkedin:${id}`, unipileId: `u${id}` },
  enabled: true, version: 1, updatedAt: noon, slots: [{ id: 'monday', day: 0, start: 0, end: 1440, features }] })
export function fixture() {
  let time = noon, dbUp = true, owner: string | undefined, epoch = 0, until = 0
  const schedules: Schedule[] = [], tasks: Task[] = [], events: Event[] = [], cooldowns: Cooldown[] = []
  const check = () => { if (!dbUp) throw fail('sql_unavailable') }
  const store: Store = {
    async ready() { check(); return true },
    async snapshot() { check(); return clone({ schedules, tasks, owner: owner ? { id: owner, epoch, until } : undefined }) },
    async schedule(value, expected) {
      check(); const i = schedules.findIndex(s => s.account.id === value.account.id)
      if ((schedules[i]?.version ?? 0) !== expected) throw fail('automation_version_conflict')
      const next = clone({ ...value, version: expected + 1 }); if (i < 0) schedules.push(next); else schedules[i] = next
      return clone(next)
    },
    async create(values) { check(); for (const value of values) if (!tasks.some(t => t.id === value.id)) tasks.push(clone(value)) },
    async save(value, event, id, token) { await store.owned(id, token, time)
      const index = tasks.findIndex(t => t.id === value.id)
      if (index < 0 || tasks[index].version !== value.version) throw fail('automation_version_conflict')
      const next = clone({ ...value, version: value.version + 1 }); tasks[index] = next; events.push(clone(event)); return clone(next) },
    async history() { check(); return clone(events) },
    async durations() { return [] },
    async claim(id) { check(); if (owner && owner !== id && time < until + 70_000) return undefined
      if (owner !== id) epoch++; owner = id; until = time + 45_000; return epoch },
    async owned(id, token) { check(); if (owner !== id || token !== epoch || time >= until) throw fail('automation_owner_lost') },
    async release(id, token) { if (owner === id && token === epoch) owner = undefined },
    async cooldown(value) { check(); const old = cooldowns.find(c => c.account === value.account && c.method === value.method)
      if (!old) cooldowns.push(clone(value)); else if (old.until < value.until) Object.assign(old, value) },
    async blockedUntil(account, method, at) { check(); return Math.max(0, ...cooldowns.filter(c =>
      [account, '*'].includes(c.account) && (c.method === method || (method !== 'action' && c.method === '*')) && c.until > at).map(c => c.until)) },
    async event(event) { check(); events.push(clone(event)) },
    async pruneLogs(before) { check(); for (let i = events.length - 1; i >= 0; i--) if (events[i].at < before) events.splice(i, 1) }
  }
  const adapters: Adapters = Object.fromEntries(['posts', 'invitations', 'withdrawals', 'comments'].map(key => [key, {
    estimate: async () => 0, step: async () => ({ status: 'completed' }), stop: async () => ({ status: 'stopped' }) }])) as any
  return { store, schedules, tasks, events, cooldowns, adapters, now: () => time,
    advance(ms: number) { time += ms }, outage(value = true) { dbUp = !value },
    create(id = 'first') { return createOrchestrator({ store, adapters, now: () => time, random: () => 0,
      sleep: async ms => { time += ms; await new Promise(r => setImmediate(r)) }, autoStart: false, owner: id }) } }
}

test('explicit continuation applies to every stopped feature without resetting budgets or saved waits', async () => {
  for (const feature of ['invitations', 'posts', 'comments', 'withdrawals'] as const) {
    const f = fixture(), s = schedule(1, [feature]); f.schedules.push(s)
    const task = plan(s, [], f.now(), () => 0)[0]
    Object.assign(task, { state: 'stopped', stopped: true, runId: 'saved-run', startedAt: f.now() - 1000,
      nextAt: f.now() + 60_000, deadlineAt: f.now() + 3600_000, activeMs: 1234 })
    f.tasks.push(task)
    const engine = f.create(); await engine.tick(); await engine.idle()
    await engine.resume(task.id)
    const saved = f.tasks.find(t => t.id === task.id)!
    assert.equal(saved.retryRequested, true, feature); assert.equal(saved.stopped, false)
    assert.equal(saved.runId, 'saved-run'); assert.equal(saved.activeMs, 1234)
    assert.equal(saved.deadlineAt, task.deadlineAt); assert.equal(saved.nextAt, task.nextAt)
    await engine.close()
  }
})

test('an omitted or expired feature deadline cannot create a tight verification loop', async () => {
  for (const nextActionAt of [undefined, 'invalid', new Date(noon - 1).toISOString()]) {
    const f = fixture(); f.schedules.push(schedule()); let reads = 0
    f.adapters.invitations.step = async () => { reads++; return { status: 'verifying', nextActionAt } }
    const engine = f.create(); await engine.tick(); await engine.idle()
    assert.equal(f.tasks[0].nextAt, noon + 60_000)
    for (let i = 0; i < 59; i++) { f.advance(1000); await engine.tick(); await engine.idle() }
    assert.equal(reads, 1); await engine.close()
  }
})

test('identity prefers provider ID over transport binding', () => {
  assert.equal(accountKey({ verifiedProviderId: 'p', unipileAccountId: 'u' }), 'linkedin:p')
  assert.throws(() => accountKey({}), { code: 'automation_account_unverified' })
})

test('all adapters can persist Stop after disconnect, but cannot resume external work with a changed identity', async () => {
  let stops = 0
  const stop = async (_id: string, requested: boolean) => { assert.equal(requested, true); stops++; return { status: 'stopped' } }
  const adapters = createFeatureAdapters({ identity: async () => { throw fail('automation_account_changed') },
    inviter: { stepManaged: stop, withdrawals: { startAutomatic() {}, stepManaged: async (_account: number, id: string, requested: boolean) => stop(id, requested) } },
    comments: { stepManaged: stop }, posts: { stepManaged: stop } } as any)
  const s = schedule(1, ['posts', 'invitations', 'comments', 'withdrawals'])
  for (const task of plan(s, [], noon, () => 0)) {
    task.runId = 'saved'
    const ctx: any = { task, now: () => noon, signal: new AbortController().signal }
    assert.equal((await adapters[task.feature].stop(ctx)).status, 'stopped')
    await assert.rejects(adapters[task.feature].step(ctx), { code: 'automation_account_changed' })
  }
  assert.equal(stops, 4)
})

test('four real feature services run for three virtual weeks with Stop, restart, SQL outage and a lost read after POST', async t => {
  const f = fixture(), inv = inviterFixture({ stack: 'GO', connectionCount: 149, confirmedReceipts: true })
  const wd = withdrawalFixture(), sleeper: { at: number; resolve(): void }[] = []
  const sleep = (ms: number) => new Promise<void>(resolve => sleeper.push({ at: f.now() + ms, resolve }))
  let providerCalls = 0, writesInFlight = 0, postCount = 0, checks = 0, injectPostReadFailure = false
  const sent = new Set<string>(), canceled = new Set<string>()
  const wrap = <T extends (...args: any[]) => Promise<any>>(action: T, write = false) => async (...args: Parameters<T>) => {
    providerCalls++
    if (write) assert.equal(writesInFlight++, 0, 'same-account mutations overlap')
    try { await new Promise(r => setImmediate(r)); return await action(...args) }
    finally { if (write) writesInFlight-- }
  }
  const send = inv.adapter.sendInvitation
  inv.adapter.sendInvitation = wrap(async (account, person) => {
    assert.ok(!sent.has(person), `duplicate invitation ${person}`); sent.add(person)
    return send(account, person)
  }, true)
  for (const key of ['getAccount', 'getOwnProfile', 'getProfile', 'resolveLocations', 'searchPeople', 'listPendingInvitations'])
    inv.adapter[key] = wrap(inv.adapter[key])
  let held = false
  const gate = { acquire() { if (held) throw fail('linkedin_operation_active'); held = true; return () => { held = false } } }
  const postDeps = createMockDependencies(gate)
  postDeps.now = f.now; postDeps.random = () => 0
  postDeps.source.accounts = async () => [{ platformAccountId: 7, clientName: 'Test', unipileAccountId: 'acc_test',
    verifiedProviderId: 'ACoOwner', linkedinUrl: 'https://www.linkedin.com/in/test-client/' }]
  const publish = postDeps.adapter.publish, readPost = postDeps.adapter.read
  postDeps.adapter.publish = wrap(async (...args: Parameters<typeof publish>) => {
    postCount++; const post = await publish(...args); post.createdAt = f.now(); return post
  }, true)
  postDeps.adapter.read = wrap(async (...args: Parameters<typeof readPost>) => {
    if (injectPostReadFailure) { injectPostReadFailure = false
      throw Object.assign(Error('read failed'), { code: 'unipile_http_500', details: { httpStatus: 500 } }) }
    return readPost(...args)
  })
  const topics = postDeps.generator.topics, draft = postDeps.generator.draft
  postDeps.generator.topics = async (...args) => {
    const value = await topics(...args) as { topics: { signature: string }[] }
    return { ...value, topics: value.topics.map(topic => ({ ...topic, signature: `${topic.signature}-${f.now()}` })) }
  }
  postDeps.generator.draft = async (...args) => {
    const value = await draft(...args) as { text: string }
    const day = String.fromCharCode(65 + Math.floor((f.now() - noon) / 86400_000))
    // Distinct synthetic provider fixtures exercise daily scheduling with the real duplicate guard enabled.
    return { ...value, text: value.text.slice(0, 600) + '\n\n' + Array.from({ length: 28 }, (_, i) =>
      `sample${day}${String.fromCharCode(97 + i)}`).join(' ') + '\n\nWhat context helps the caller?\n\n#Go #Backend #CodeReview #SoftwareEngineering' }
  }
  wd.runtime.now = f.now; wd.runtime.sleep = sleep; wd.runtime.gate = gate
  wd.runtime.assertRead = () => {}; wd.runtime.assertWrite = () => {}
  wd.provider.verify = wrap(async () => {})
  wd.provider.list = wrap(wd.provider.list)
  const cancel = wd.provider.cancel
  wd.provider.cancel = wrap(async (account, id) => { assert.ok(!canceled.has(id)); canceled.add(id); await cancel(account, id) }, true)
  const records = new Map<string, any>()
  const commentOptions = { autoStart: false, now: f.now, random: () => 0, sleep, gate, loggerFor: () => ({ event() {} }),
    store: { async list() { return clone([...records.values()]) }, async get(id: string) { return clone(records.get(id)) },
      async create(job: any) { records.set(job.jobId, clone(job)) }, async update(job: any) { records.set(job.jobId, clone(job)) }, async purge() {} },
    repository: inv.repository,
    adapter: { getAccount: inv.adapter.getAccount, listPosts: wrap(async () => ({ items: [{ id: `post-${postCount}`, text: 'Go error handling' }] })),
      listComments: wrap(async () => { checks++; return { items: [] } }) }, openai: {} }
  let services: any, engine!: ReturnType<typeof createOrchestrator>
  const create = () => {
    services = { inviter: createConnectionInviterService({ ...inv, now: () => new Date(f.now()), sleep, random: () => 0,
      autoRecover: false, enforceWriterSingleton: false, gate }), posts: createPostWriterService(postDeps, false),
      comments: ((commentsModule as any).default ?? commentsModule).createCommentMonitorService(commentOptions) }
    services.inviter.withdrawals = createInvitationWithdrawal(wd.runtime)
    engine = createOrchestrator({ store: f.store, adapters: createFeatureAdapters(services), now: f.now, random: () => 0,
      sleep, autoStart: false })
  }
  const pump = async (seconds = 5) => {
    for (let i = 0; i < seconds; i++) {
      f.advance(1000)
      for (const item of sleeper.splice(0)) if (item.at <= f.now()) item.resolve(); else sleeper.push(item)
      await engine.tick()
      for (let j = 0; j < 6; j++) await new Promise(r => setImmediate(r))
    }
  }
  const close = async () => {
    const closing = engine.close(); await pump(3); await closing
    services.inviter.stop(); services.comments.stop(); await services.posts.close()
  }
  create()
  const s = schedule(7, ['invitations', 'posts', 'comments', 'withdrawals'])
  s.account.key = 'linkedin:ACoOwner'; s.account.unipileId = 'acc_test'
  // Allow the explicit Stop/restart and required handoff pauses before the last feature starts.
  // Slot expiry itself is covered separately; a two-minute slot legitimately misses withdrawals here.
  s.slots = Array.from({ length: 7 }, (_, day) => ({ id: `day-${day}`, day, start: 720, end: 725,
    features: ['invitations', 'posts', 'comments', 'withdrawals'] }))
  f.schedules.push(s)
  try {
    for (let day = 0; day < 21; day++) {
      const dayStart = noon + day * 86400_000
      if (f.now() < dayStart) f.advance(dayStart - f.now())
      wd.pending([{ id: `old-${day}`, name: 'old', createdAt: '2026-08-01T00:00:00Z' }])
      if (day === 3) injectPostReadFailure = true
      if (day === 2) {
        f.outage(); const before = providerCalls; await pump(10)
        assert.equal(providerCalls, before, 'provider called during SQL outage'); f.outage(false)
      }
      await pump(5)
      if (day === 1) {
        await engine.saveSchedule({ ...f.schedules[0], enabled: false }, f.schedules[0].version)
        await pump(20); const before = providerCalls; await pump(20); assert.equal(providerCalls, before)
        await close(); create(); await pump(1)
        await engine.saveSchedule({ ...f.schedules[0], enabled: true }, f.schedules[0].version)
        for (const task of f.tasks.filter(task => task.day === dateMsk(f.now()) && task.state === 'stopped')) await engine.resume(task.id)
      }
      for (let i = 0; i < 360; i++) {
        await pump(5)
        const today = f.tasks.filter(task => task.day === dateMsk(f.now()))
        if (today.filter(task => task.feature !== 'comments').length === 3 &&
          today.filter(task => task.feature !== 'comments').every(task => task.state === 'completed') &&
          today.some(task => task.feature === 'comments' && task.runId && task.state !== 'running')) break
      }
      const today = f.tasks.filter(task => task.day === dateMsk(f.now()))
      if (today.some(task => task.feature === 'posts' && task.state === 'needs_attention'))
        t.diagnostic(JSON.stringify((await services.posts.get(7)).runs.map((run: any) => ({ status: run.status, issues: run.issues, errorCode: run.errorCode }))))
      assert.ok(today.filter(task => task.feature !== 'comments').every(task => task.state === 'completed'),
        JSON.stringify({ tasks: today.map(task => ({ day, feature: task.feature, state: task.state, reason: task.reason })),
          events: f.events.filter(event => event.at >= dayStart && event.at < dayStart + 180_000)
            .map(event => ({ seconds: (event.at - dayStart) / 1000, feature: event.feature, code: event.code })) }))
      if (day === 7 || day === 14) { await close(); create() }
    }
    assert.equal(postCount, 21); assert.equal(canceled.size, 21); assert.equal(sent.size, 21 * 5)
    assert.ok(checks >= 21); assert.equal(held, false)
    assert.ok(f.events.some(event => event.code === 'resumed'))
    assert.ok(f.events.some(event => event.code === 'action_pause'))
    t.diagnostic(`21 virtual days: ${sent.size} invitations, ${postCount} posts, ${canceled.size} withdrawals, ${checks} comment checks; no duplicates`)
  } finally { await close() }
})

test('calendar rejects overlaps and impossible values but accepts adjacent and midnight slots', () => {
  const s = schedule(); s.slots = [{ id: 'a', day: 0, start: 0, end: 30, features: ['posts'] },
    { id: 'b', day: 0, start: 30, end: 1440, features: ['invitations'] }]
  validateSchedule(s); s.slots[1].start = 29; assert.throws(() => validateSchedule(s), /пересекаются/)
  s.slots[1].start = 1441; assert.throws(() => validateSchedule(s), /Проверьте/)
})
test('random starts persist; daily keys survive schedule edits; withdrawal remains once per slot', () => {
  const s = schedule(1, ['posts', 'invitations', 'withdrawals'])
  const first = plan(s, [], noon, () => .8)
  assert.equal(first.length, 3); assert.equal(new Set(first.map(t => t.plannedAt)).size, 3)
  assert.ok(first.every(t => t.plannedAt >= noon && t.plannedAt < t.windowEnd))
  s.version++; assert.equal(plan(s, first, noon, () => 0).length, 0)
})
test('short slots still allow a start and duration history supplies a bounded reserve', () => {
  const s = schedule(); s.slots[0].start = 720; s.slots[0].end = 725
  assert.equal(plan(s, [], noon, () => .99).length, 1)
  assert.equal(reserve('comments', 0, [600_000]), 1_380_000)
})

test('new plans place withdrawals last regardless of checkbox order and preserve saved starts', () => {
  const s = schedule(1, ['withdrawals', 'invitations', 'posts', 'comments'])
  const first = plan(s, [], noon, () => .5)
  assert.deepEqual(first.filter(t => t.feature !== 'comments').map(t => t.feature), ['invitations', 'posts', 'withdrawals'])
  assert.ok(first.find(t => t.feature === 'withdrawals')!.plannedAt > first.find(t => t.feature === 'posts')!.plannedAt)
  assert.deepEqual(plan(s, first, noon, () => 0), [])
})

test('withdrawals are last among due features without waiting for a recurring comment session to finish', async () => {
  const f = fixture(), s = schedule(1, ['withdrawals', 'comments', 'invitations', 'posts'])
  s.commentsActivatedAt = noon; f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
  const starts: string[] = []
  for (const feature of ['posts', 'invitations', 'comments', 'withdrawals'] as const) f.adapters[feature].step = async () => {
    starts.push(feature)
    return feature === 'comments' ? { status: 'waiting', nextActionAt: new Date(noon + 3600_000).toISOString() } : { status: 'completed' }
  }
  const c = f.create()
  try {
    for (let i = 0; i < 4; i++) { await c.tick(); await c.idle(); f.advance(10_000) }
    assert.deepEqual(starts, ['posts', 'invitations', 'comments', 'withdrawals'])
  } finally { await c.close() }
})

test('higher priority waits do not prevent a due withdrawal; unknown outcomes still reconcile first', async () => {
  for (const verifying of [false, true]) {
    const f = fixture(), s = schedule(1, ['posts', 'withdrawals']); f.schedules.push(s)
    f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t,
      nextAt: t.feature === 'posts' && !verifying ? noon + 3600_000 : noon,
      ...(t.feature === 'withdrawals' && verifying ? { state: 'verifying' as const, runId: 'saved-cancel' } : {}) })))
    const starts: string[] = []
    for (const feature of ['posts', 'withdrawals'] as const) f.adapters[feature].step = async () => {
      starts.push(feature); return { status: 'completed' }
    }
    const c = f.create()
    try { await c.tick(); await c.idle(); assert.deepEqual(starts, ['withdrawals']) }
    finally { await c.close() }
  }
})

test('started features continue after a slot ends, retaining their run and provider wait across restart', async () => {
  for (const feature of ['invitations', 'posts', 'withdrawals'] as const) {
    const f = fixture(), s = schedule(1, [feature]); s.slots[0].start = 720; s.slots[0].end = 721
    f.schedules.push(s); let calls = 0
    f.adapters[feature].step = async ctx => {
      calls++; await ctx.bind('same-run'); await ctx.assertWrite()
      return calls === 1 ? { status: 'waiting', nextActionAt: new Date(noon + 120_000).toISOString() } : { status: 'completed' }
    }
    const a = f.create(); await a.tick(); await a.idle()
    const saved = clone(f.tasks[0]); await a.close()
    const b = f.create('restarted'); f.advance(90_000); await b.tick(); await b.idle()
    assert.equal(calls, 1, `${feature}: provider wait remains in force`)
    f.advance(30_000); await b.tick(); await b.idle()
    assert.equal(calls, 2, `${feature}: started work continues outside the slot`)
    assert.equal(f.tasks[0].state, 'completed'); assert.equal(f.tasks[0].runId, saved.runId)
    assert.equal(f.tasks[0].plannedAt, saved.plannedAt); assert.equal(f.tasks[0].deadlineAt, saved.deadlineAt)
    await b.close()
  }
})

test('a feature which never started cannot begin after the slot closed', async () => {
  const f = fixture(), s = schedule(); s.slots[0].start = 720; s.slots[0].end = 721
  f.schedules.push(s); f.tasks.push(...plan(s, [], noon, () => .5)); let calls = 0
  f.adapters.invitations.step = async () => { calls++; return { status: 'completed' } }
  f.advance(120_000); const c = f.create(); await c.tick(); await c.idle()
  assert.equal(calls, 0); assert.equal(f.tasks[0].startedAt, undefined)
  assert.equal(f.tasks[0].state, 'stopped'); assert.equal(f.tasks[0].reason, 'automation_window_missed'); await c.close()
})
test('new comments wait for their slot; started comments retain the active day', () => {
  const s = schedule(1, ['comments']); s.slots[0].start = 780; s.slots[0].end = 840
  assert.equal(plan(s, [], noon, () => 0)[0].plannedAt, noon + 3600_000)
  assert.equal(windowFor(s, 'comments', noon)?.start, noon + 3600_000)
  assert.equal(windowFor(s, 'comments', noon + 4 * 3600_000, true)?.start, noon + 4 * 3600_000)
  assert.ok(windowFor(s, 'comments', noon + 86400_000, true)!.start > noon + 86400_000)
  assert.deepEqual(plan(s, [], noon + 4 * 3600_000, () => 0), [])
})

test('new comment task waits across restart, then continues beyond its slot', async () => {
  const f = fixture(), s = schedule(1, ['comments'])
  s.slots[0].start = 780; s.slots[0].end = 840; f.schedules.push(s)
  let calls = 0
  f.adapters.comments.step = async ctx => {
    calls++; await ctx.assertWrite(); await ctx.bind('saved-comment-session')
    return { status: 'waiting', nextActionAt: new Date(f.now() + 2 * 3600_000).toISOString() }
  }
  let engine = f.create()
  await engine.tick(); await engine.idle(); assert.equal(calls, 0)
  await engine.close(); engine = f.create('restart')
  await engine.tick(); await engine.idle(); assert.equal(calls, 0)
  f.advance(3600_000); await engine.tick(); await engine.idle(); assert.equal(calls, 1)
  f.advance(2 * 3600_000); await engine.tick(); await engine.idle(); assert.equal(calls, 2)
  assert.equal(f.tasks[0].runId, 'saved-comment-session'); await engine.close()
})
test('repeated ticks execute one persisted daily task', async () => {
  const f = fixture(); f.schedules.push(schedule()); let writes = 0
  f.adapters.invitations.step = async ctx => { await ctx.bind('run-1'); await ctx.assertWrite(); writes++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await c.idle(); f.advance(10_000); await c.tick(); await c.idle()
  assert.equal(writes, 1); assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0].runId, 'run-1'); await c.close()
})
test('HTTP queue waiting does not spend the active budget or trigger its watchdog', async () => {
  const f = fixture(), s = schedule(); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, startedAt: noon, runId: 'same-run',
    activeLimitMs: 5, deadlineAt: noon + 3600_000 })))
  const deadline = f.tasks[0].deadlineAt; let requests = 0
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now, random: () => 0,
    sleep: async ms => { await new Promise(r => setTimeout(r, 20)); f.advance(ms) },
    assertOwner: async () => {}, onFailure() {} }))
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++; return new Response('{}') } })
  f.adapters.invitations.step = ctx => withRequestContext({ account: 'u1', taskId: ctx.task.id,
    signal: ctx.signal, waitForRequest: ctx.waitForRequest, assertWrite: ctx.assertWrite }, async () => {
    await client.request('GET', '/u1/users/me')
    await client.request('POST', '/u1/users/me/relation-requests', {})
    assert.equal(ctx.signal.aborted, false)
    return { status: 'completed' }
  })
  const c = f.create()
  try {
    await c.tick(); await c.idle()
    assert.equal(requests, 2); assert.equal(f.tasks[0].state, 'completed')
    assert.equal(f.tasks[0].activeMs, 0); assert.equal(f.tasks[0].deadlineAt, deadline)
  } finally { dispose(); await c.close() }
})
test('a queue wait inside a cooperative feature pause is excluded exactly once', async () => {
  const f = fixture(); f.schedules.push(schedule())
  f.adapters.invitations.step = async ctx => {
    f.advance(1000)
    await ctx.cooperate(async () => {
      f.advance(5000)
      await ctx.waitForRequest!(async () => { f.advance(15_000) })
      f.advance(5000)
    }, noon + 26_000)
    f.advance(1000); await ctx.assertWrite()
    return { status: 'completed' }
  }
  const c = f.create(); await c.tick(); await c.idle()
  assert.equal(f.tasks[0].state, 'completed'); assert.equal(f.tasks[0].activeMs, 2000)
  await c.close()
})
test('excluding queue wait from active time does not extend the hard deadline', async () => {
  const f = fixture(), s = schedule(); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, startedAt: noon, runId: 'same-run', deadlineAt: noon + 1000 })))
  f.adapters.invitations.step = async ctx => {
    await ctx.waitForRequest!(async () => { f.advance(2000) })
    await assert.rejects(ctx.assertWrite(), { code: 'automation_stop_requested' })
    return { status: 'stopped' }
  }
  const c = f.create(); await c.tick(); await c.idle()
  assert.equal(f.tasks[0].state, 'stopped'); assert.equal(f.tasks[0].deadlineAt, noon + 1000)
  assert.equal(f.tasks[0].activeMs, 0); await c.close()
})
test('all students may run concurrently; a second feature of one student waits', async () => {
  const f = fixture(); for (let i = 1; i <= 5; i++) f.schedules.push(schedule(i, ['invitations', 'withdrawals']))
  let release!: () => void; const waiting = new Promise<void>(r => { release = r }); const active = new Set<number>()
  f.adapters.invitations.step = async ctx => { active.add(ctx.task.account.id); await waiting; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await new Promise(r => setImmediate(r))
  assert.equal(active.size, 5); assert.equal(f.tasks.filter(t => t.state === 'running').length, 5)
  release(); await c.idle(); await c.close()
})
test('account is released during a saved wait; another due feature proceeds', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'withdrawals']); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
  f.adapters.invitations.step = async () => ({ status: 'waiting', nextActionAt: new Date(noon + 3600_000).toISOString() })
  const c = f.create(); await c.tick(); await c.idle(); f.advance(10_000); await c.tick(); await c.idle()
  assert.equal(f.tasks.find(t => t.feature === 'withdrawals')?.state, 'completed'); await c.close()
})

test('complete actions remain indivisible; random pauses survive restart and do not stack with feature waits', async () => {
  for (const sample of [0, .5, 1]) {
    const f = fixture(), s = schedule(1, ['invitations', 'withdrawals']); f.schedules.push(s)
    f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
    const order: string[] = []; let release!: () => void, entered!: () => void
    const hold = new Promise<void>(r => release = r), start = new Promise<void>(r => entered = r)
    f.adapters.invitations.step = async ctx => {
      order.push('profile')
      await ctx.waitForRequest!(async () => { entered(); await hold })
      order.push('send', 'save')
      return { status: 'waiting', nextActionAt: new Date(f.now() + 3600_000).toISOString() }
    }
    f.adapters.withdrawals.step = async () => { order.push('withdraw'); return { status: 'completed' } }
    const c = createOrchestrator({ ...f, autoStart: false, random: () => sample, owner: 'action' })
    await c.tick(); await start; f.advance(20_000); await c.tick()
    assert.deepEqual(order, ['profile'])
    release(); await c.idle()
    const pause = 10_000 + sample * 10_000
    assert.equal(f.cooldowns.find(v => v.method === 'action')!.until, f.now() + pause)
    await c.close(); const next = f.create('restart')
    f.advance(pause - 1); await next.tick(); await next.idle()
    assert.deepEqual(order, ['profile', 'send', 'save'])
    f.advance(1); await next.tick(); await next.idle()
    assert.deepEqual(order, ['profile', 'send', 'save', 'withdraw'])
    assert.equal(f.tasks.find(t => t.feature === 'invitations')!.nextAt, noon + 20_000 + 3600_000)
    await next.close()
  }
})

test('ready steps alternate instead of one feature starving the others', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'comments', 'withdrawals']); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
  const order: string[] = []
  for (const key of ['invitations', 'comments', 'withdrawals'] as const)
    f.adapters[key].step = async () => { order.push(key); return { status: 'ready' } }
  const c = f.create()
  for (let i = 0; i < 6; i++) { await c.tick(); await c.idle(); f.advance(10_000) }
  assert.deepEqual(order, ['invitations', 'comments', 'withdrawals', 'invitations', 'comments', 'withdrawals'])
  await c.close()
})

test('a failed action-pause save prevents another feature from writing', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'withdrawals']); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
  let writes = 0
  f.store.cooldown = async () => { throw fail('sql_unavailable') }
  f.adapters.withdrawals.step = async () => { writes++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await c.idle()
  assert.equal((await c.status()).isOwner, false); assert.equal(writes, 0)
  f.advance(5000); await c.tick(); await c.idle()
  assert.equal(writes, 0, 'a recovered lease must not erase the pending action pause')
  await c.close()
})

test('cooperative pacing leaves the continuation alive while another feature runs', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'withdrawals']); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon })))
  let release!: () => void, yielded!: () => void, withdrawals = 0, invocations = 0
  const wait = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { yielded = r })
  f.adapters.invitations.step = async ctx => {
    invocations++; await ctx.bind('cached-run')
    await ctx.cooperate(async () => { yielded(); await wait }, noon + 600_000)
    await ctx.assertWrite(); return { status: 'completed' }
  }
  f.adapters.withdrawals.step = async () => { withdrawals++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await started; f.advance(10_000); await c.tick()
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))
  assert.equal(withdrawals, 1); assert.equal(invocations, 1)
  assert.equal(f.tasks.find(t => t.feature === 'invitations')?.state, 'waiting')
  f.advance(600_000); await c.tick(); release(); await c.idle()
  const run = f.tasks.find(t => t.feature === 'invitations')!
  assert.equal(run.state, 'completed'); assert.equal(run.activeMs, 0); assert.equal(run.runId, 'cached-run')
  await c.close()
})

test('loss of executor ownership pauses rather than recording a user Stop', async () => {
  const f = fixture(); f.schedules.push(schedule()); let ready!: () => void, release!: () => void
  const started = new Promise<void>(r => { ready = r }), wait = new Promise<void>(r => { release = r })
  f.adapters.invitations.step = async ctx => { await ctx.bind('run'); ready(); await wait
    await ctx.assertWrite(); return { status: 'completed' } }
  const c = f.create(); await c.tick(); await started; c.suspend(fail('sql_unavailable')); release(); await c.idle()
  assert.notEqual(f.tasks[0].stopped, true); assert.equal(f.tasks[0].state, 'running')
  f.adapters.invitations.step = async () => ({ status: 'completed' })
  await c.tick(); await c.idle(); assert.equal(f.tasks[0].state, 'completed'); await c.close()
})

test('orphaned running step is checked before independent work continues', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'posts']); f.schedules.push(s)
  f.tasks.push(...plan(s, [], noon, () => 0).map(t => ({ ...t, nextAt: noon,
    ...(t.feature === 'invitations' ? { state: 'running' as const, runId: 'sent-run' } : {}) })))
  let posts = 0
  f.adapters.invitations.step = async () => ({ status: 'verifying', nextActionAt: new Date(noon + 3600_000).toISOString() })
  f.adapters.posts.step = async () => { posts++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await c.idle(); f.advance(10_000); await c.tick(); await c.idle()
  assert.equal(posts, 1); assert.ok(f.events.some(e => e.code === 'recovery_check')); await c.close()
})

test('manual retry prepares the same feature run before its next step', async () => {
  const f = fixture(); f.schedules.push(schedule()); const calls: string[] = []
  f.adapters.invitations.step = async ctx => { calls.push('step'); await ctx.bind('same')
    return calls.length === 1 ? { status: 'needs_attention' } : { status: 'completed' } }
  f.adapters.invitations.resume = async ctx => { assert.equal(ctx.task.runId, 'same'); calls.push('resume') }
  const c = f.create(); await c.tick(); await c.idle(); await c.resume(f.tasks[0].id); f.advance(10_000); await c.tick(); await c.idle()
  assert.deepEqual(calls, ['step', 'resume', 'step']); assert.equal(f.tasks[0].state, 'completed'); await c.close()
})

test('explicit resume of a stopped inviter requires an enabled current-day schedule', async () => {
  const f = fixture(), s = schedule(); f.schedules.push(s)
  f.tasks.push({ ...plan(s, [], noon, () => 0)[0], state: 'stopped', stopped: true, stopApplied: true, runId: 'old' })
  let resumes = 0; f.adapters.invitations.resume = async () => { resumes++ }
  const c = f.create(); await c.tick(); await c.saveSchedule({ ...s, enabled: false }, 1)
  await assert.rejects(c.resume(f.tasks[0].id), { code: 'automation_resume_invalid' })
  await c.saveSchedule({ ...s, enabled: true }, 2)
  await c.resume(f.tasks[0].id); await c.tick(); await c.idle()
  assert.equal(resumes, 1); assert.equal(f.tasks[0].state, 'completed')
  assert.equal(f.tasks[0].runId, 'old'); await c.close()
})

test('four weeks of ticks and restarts never replay finished tasks or block other accounts', async () => {
  const f = fixture(); f.schedules.push(schedule(1, ['posts', 'invitations', 'withdrawals']), schedule(2, ['invitations']))
  const calls = new Set<string>()
  for (const feature of ['posts', 'invitations', 'withdrawals'] as const) f.adapters[feature].step = async ctx => {
    assert.equal(calls.has(ctx.task.id), false); calls.add(ctx.task.id); return { status: 'completed' }
  }
  for (let week = 0; week < 4; week++) {
    const c = f.create(`week-${week}`)
    for (let slot = 0; slot < 3; slot++) {
      await c.tick(); await c.idle(); await c.tick(); await c.idle()
      if (slot < 2) f.advance(4 * 3600_000)
    }
    await c.close()
    if (week < 3) f.advance(7 * 86400_000 - 8 * 3600_000)
  }
  assert.equal(calls.size, 16); assert.ok(f.tasks.every(t => t.state === 'completed'))
})
test('two backends cannot execute the same task', async () => {
  const f = fixture(); f.schedules.push(schedule()); let count = 0
  f.adapters.invitations.step = async () => { count++; return { status: 'completed' } }
  const a = f.create('a'), b = f.create('b'); await Promise.all([a.tick(), b.tick()]); await Promise.all([a.idle(), b.idle()])
  assert.equal(count, 1); assert.notEqual((await a.status()).isOwner, (await b.status()).isOwner)
  await a.close(); await b.close()
})
test('restart retains run ID, randomized time and provider deadline', async () => {
  const f = fixture(); f.schedules.push(schedule()); let count = 0
  f.adapters.invitations.step = async ctx => { count++; if (!ctx.task.runId) await ctx.bind('existing')
    return { status: 'waiting', nextActionAt: new Date(f.now() + 120_000).toISOString() } }
  const a = f.create(); await a.tick(); await a.idle(); const saved = clone(f.tasks[0]); await a.close()
  const b = f.create('b'); await b.tick(); await b.idle(); assert.equal(count, 1)
  assert.equal(f.tasks[0].plannedAt, saved.plannedAt); assert.equal(f.tasks[0].runId, 'existing')
  f.advance(120_000); await b.tick(); await b.idle(); assert.equal(count, 2); await b.close()
})
test('SQL failure before checkpoint prohibits the provider write', async () => {
  const f = fixture(); f.schedules.push(schedule()); let sent = 0
  f.adapters.invitations.step = async ctx => { f.outage(); await ctx.bind('run'); sent++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await c.idle(); assert.equal(sent, 0)
  assert.equal((await c.status().catch(() => ({ isOwner: false }))).isOwner, false); f.outage(false); await c.close()
})
test('disable aborts an in-progress step before the next POST', async () => {
  const f = fixture(); f.schedules.push(schedule()); let ready!: () => void, release!: () => void, sent = 0
  const started = new Promise<void>(r => { ready = r }), wait = new Promise<void>(r => { release = r })
  f.adapters.invitations.step = async ctx => { ready(); await wait; await ctx.assertWrite(); sent++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await started
  await c.saveSchedule({ ...schedule(), enabled: false }, 1); release(); await c.idle()
  assert.equal(sent, 0); await c.close()
})
test('disabling stops a verifier without waiting for its provider deadline', async () => {
  const f = fixture(); f.schedules.push(schedule()); let checks = 0
  f.adapters.invitations.step = async ctx => { await ctx.bind('sent'); return { status: 'verifying', nextActionAt: new Date(noon + 60_000).toISOString() } }
  f.adapters.invitations.stop = async () => { checks++; return { status: 'stopped' } }
  const c = f.create(); await c.tick(); await c.idle(); await c.saveSchedule({ ...schedule(), enabled: false }, 1)
  await c.tick(); await c.idle(); assert.equal(checks, 1)
  f.advance(60_000); await c.tick(); await c.idle(); assert.equal(checks, 1); await c.close()
})
test('deadline stops a run instead of granting another full timeout', async () => {
  const f = fixture(); f.schedules.push(schedule()); let stops = 0
  f.adapters.invitations.step = async ctx => { await ctx.bind('slow'); return { status: 'waiting', nextActionAt: new Date(noon + 5 * 86400_000).toISOString() } }
  f.adapters.invitations.stop = async () => { stops++; return { status: 'stopped' } }
  const c = f.create(); await c.tick(); await c.idle(); f.advance(86400_001); await c.tick(); await c.idle()
  assert.equal(stops, 1); await c.close()
})
test('comments wait for a confirmed post; without posts they start immediately', async () => {
  const f = fixture(); f.schedules.push(schedule(1, ['posts', 'comments']), schedule(2, ['comments'])); const ids: number[] = []
  f.adapters.posts.step = async () => ({ status: 'completed', publishedAt: noon })
  f.adapters.comments.step = async ctx => { ids.push(ctx.task.account.id); return { status: 'waiting', nextActionAt: new Date(noon + 60_000).toISOString() } }
  const c = f.create(); await c.tick(); await c.idle(); assert.deepEqual(ids, [2]); f.advance(10_000); await c.tick(); await c.idle()
  assert.deepEqual(ids, [2, 1]); await c.close()
})

test('unstarted comments end with an explicit unmet dependency, including a saved future wait', async () => {
  for (const futureWait of [false, true]) {
    const f = fixture(), s = schedule(1, ['posts', 'comments']); f.schedules.push(s)
    const task = plan(s, [], noon, () => 0).find(t => t.feature === 'comments')!
    if (futureWait) { task.state = 'waiting'; task.nextAt = noon + 7 * 86400_000 }
    f.tasks.push(task); let calls = 0
    f.adapters.comments.step = async () => { calls++; return { status: 'completed' } }
    f.advance(86400_000); const c = f.create(); await c.tick(); await c.idle()
    assert.equal(calls, 0); assert.equal(f.tasks[0].state, 'needs_attention')
    assert.equal(f.tasks[0].reason, 'comments_post_not_published')
    assert.equal(f.tasks[0].updatedAt, f.now()); assert.equal(f.tasks[0].runId, undefined)
    assert.match(f.events.at(-1)!.message, /не запущены.*пост не опубликован/i); await c.close()
  }
})

test('a real comment session finishes its day while unknown replies retain their verification deadline', async () => {
  for (const state of ['waiting', 'verifying'] as const) {
    const f = fixture(), s = schedule(1, ['comments']); f.schedules.push(s)
    const task = { ...plan(s, [], noon, () => 0)[0], state, runId: 'session', startedAt: noon, nextAt: noon + 3 * 86400_000 }
    f.tasks.push(task); f.advance(86400_000); const c = f.create(); await c.tick(); await c.idle()
    assert.equal(f.tasks[0].state, state === 'verifying' ? 'verifying' : 'completed')
    assert.equal(f.tasks[0].runId, 'session')
    if (state === 'verifying') assert.equal(f.tasks[0].nextAt, task.nextAt)
    else assert.equal(f.tasks[0].reason, 'active_day_finished')
    await c.close()
  }
})

test('legacy false comment completion is corrected once without executing or clearing history', async () => {
  const f = fixture(), s = schedule(1, ['comments']); f.schedules.push(s)
  f.tasks.push({ ...plan(s, [], noon, () => 0)[0], state: 'completed' })
  f.advance(86400_000); const c = f.create(); await c.tick(); await c.idle(); await c.tick()
  assert.equal(f.tasks[0].state, 'needs_attention'); assert.equal(f.tasks[0].reason, 'comments_not_started')
  assert.equal(f.events.filter(e => e.code === 'comments_not_started').length, 1)
  assert.equal(f.tasks[0].startedAt, undefined); await c.close()
})

test('only an account session rejection records account authorization failure', async () => {
  const f = fixture(), errors: string[] = [], accountFailures: string[] = []
  const p = createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {},
    onFailure: e => errors.push(String(e)),
    onAccountAuthFailure: async (id, code) => { accountFailures.push(`${id}:${code}`) } })
  const info = { account: 'u1', method: 'GET', operation: 'users', write: false }
  for (const code of ['unipile_provider_invalid_authorization', 'unipile_invalid_api_key', 'unipile_http_500'])
    await p.failed!(info, { code, details: { httpStatus: code.endsWith('500') ? 500 : 401 } })
  assert.deepEqual(accountFailures, ['u1:unipile_provider_invalid_authorization'])
  assert.equal(errors.length, 0); assert.equal(f.events.length, 3)
})

test('account auth failures update only the current binding, once, without extra provider requests', async () => {
  const f = fixture(), storage = Object.assign(f.store, { withdrawals: { async load() { return undefined }, async save() {} }, async importWithdrawal() {} })
  const accounts = [1, 2].map(id => ({ platformAccountId: id, clientId: id + 100, clientName: `Test ${id}`,
    unipileAccountId: `u${id}`, verifiedProviderId: `p${id}`, authErrorCode: '' }))
  const writes: number[] = []
  const runtime = await prepareLinkedInAutomation(storage, { listAccounts: async () => accounts as any,
    async recordFailure(id, value) { writes.push(id); accounts.find(a => a.platformAccountId === id)!.authErrorCode = value.errorCode }
  }, { now: f.now, autoStart: false })
  assert.ok(runtime)
  const { requestFailed } = (controlModule as any).default ?? controlModule
  const error = { code: 'unipile_provider_invalid_authorization', details: { httpStatus: 401 } }
  try {
    await requestFailed(requestInfo('GET', '/u1/users/me'), error)
    await requestFailed(requestInfo('GET', '/u1/users/me'), error)
    accounts[0].unipileAccountId = 'reconnected'; accounts[0].authErrorCode = ''
    await requestFailed(requestInfo('GET', '/u1/users/me'), error)
    assert.deepEqual(writes, [1]); assert.equal(accounts[0].authErrorCode, ''); assert.equal(accounts[1].authErrorCode, '')
  } finally { await runtime.close() }
})
test('saved unknown connection result lets independent posts proceed without a grace lock', async () => {
  const f = fixture(), s = schedule(1, ['invitations', 'posts']); f.schedules.push(s)
  const task = plan(s, [], noon, () => 0).find(t => t.feature === 'invitations')!
  f.tasks.push({ ...task, state: 'verifying', uncertainSince: noon, nextAt: noon + 3600_000 })
  f.tasks.push({ ...plan(s, [], noon, () => 0).find(t => t.feature === 'posts')!, nextAt: noon })
  let posts = 0; f.adapters.posts.step = async () => { posts++; return { status: 'completed' } }
  const c = f.create(); await c.tick(); await c.idle(); assert.equal(posts, 1)
  f.advance(10 * 60_000); await c.tick(); await c.idle(); assert.equal(posts, 1); await c.close()
})

test('a new invitation day proceeds beside old verification and keeps the shared provider deadline', async () => {
  const f = fixture(), s = schedule(); f.schedules.push(s)
  const today = plan(s, [], noon, () => 0)[0]
  const old = { ...today, id: 'yesterday', day: '2026-09-27', state: 'verifying' as const,
    runId: 'old-run', nextAt: noon + 2 * 3600_000 }
  f.tasks.push(old)
  let sends = 0
  f.adapters.invitations.step = async ctx => {
    assert.notEqual(ctx.task.id, old.id); sends++; return { status: 'completed' }
  }
  const until = noon + 60_000
  await f.store.cooldown({ account: s.account.key, method: '*', until, observedAt: noon, code: 'unipile_rate_limit' })
  let engine = f.create(); await engine.tick(); await engine.idle()
  assert.equal(sends, 0); await engine.close()
  f.advance(60_000); engine = f.create('restart'); await engine.tick(); await engine.idle()
  assert.equal(sends, 1)
  assert.equal(f.tasks.find(t => t.id === old.id)?.state, 'verifying')
  assert.equal(f.tasks.find(t => t.id === old.id)?.runId, 'old-run')
  assert.equal(f.tasks.find(t => t.id === old.id)?.nextAt, old.nextAt)
  assert.equal(canRunBesideUnknown({ ...today, id: 'same-day-copy', day: old.day }, old, noon), false)
  await engine.close()
})

test('an unknown publication does not block a like on another already published post', () => {
  const pending = { ...plan(schedule(1, ['posts']), [], noon, () => 0)[0], state: 'verifying' as const }
  assert.equal(canRunBesideUnknown({ ...pending, id: 'other-post:likes', feature: 'likes' as any }, pending, noon), true)
})

test('disabling a saved verification stops it immediately despite its future deadline', async () => {
  const f = fixture(), s = schedule(1); s.enabled = false; f.schedules.push(s)
  const task = plan({ ...s, enabled: true }, [], noon, () => 0)[0]
  f.tasks.push({ ...task, runId: 'unknown', state: 'verifying', nextAt: noon + 24 * 3600_000 })
  let stops = 0; f.adapters.invitations.stop = async () => { stops++; return { status: 'stopped' } }
  const c = f.create(); await c.tick(); await c.idle()
  assert.equal(stops, 1); assert.equal(f.tasks[0].state, 'stopped'); await c.close()
})

test('an aborted step cannot start a read request', async () => {
  const f = fixture(), signal = new AbortController(); signal.abort('disabled')
  const p = createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {}, onFailure() {} })
  await assert.rejects(p.before!({ account: 'u1', write: false, method: 'GET', operation: 'users' },
    { signal: signal.signal }), { code: 'automation_stop_requested' })
  assert.equal(f.events.filter(e => e.code === 'request_started').length, 0)
})

test('unknown-result isolation applies to every feature without expiring duplicate protection', () => {
  const features = ['invitations', 'posts', 'withdrawals', 'comments'] as const
  const permitted = { invitations: ['posts', 'comments', 'withdrawals'], withdrawals: ['posts', 'comments', 'invitations'],
    posts: ['invitations', 'withdrawals'], comments: ['invitations', 'posts', 'withdrawals'] }
  const tasks = plan(schedule(1, [...features]), [], noon, () => 0)
  for (const pending of tasks) for (const candidate of tasks) for (const elapsed of [0, 60_000, 30 * 86400_000]) {
    const unknown = { ...pending, state: 'verifying' as const, uncertainSince: noon }
    assert.equal(canRunBesideUnknown({ ...candidate, id: candidate.id + ':new' }, unknown, noon + elapsed),
      (permitted[pending.feature] as string[]).includes(candidate.feature), `${pending.feature} -> ${candidate.feature}`)
    assert.equal(canRunBesideUnknown({ ...candidate, account: { ...candidate.account, key: 'another' } }, unknown, noon + elapsed), true)
  }
})

for (const feature of ['posts', 'invitations', 'withdrawals', 'comments'] as const) {
  test(`${feature}: a transient provider failure retries the saved run and lets independent work proceed`, async () => {
    const f = fixture(), s = schedule(1, [feature])
    f.schedules.push(s, schedule(2, ['invitations']))
    let attempts = 0
    const adapter = f.adapters[feature]
    adapter.step = async ctx => {
      if (ctx.task.account.id !== 1) return { status: 'completed' }
      await ctx.bind('same-run'); attempts++
      if (attempts === 1) throw Object.assign(new Error('provider'), {
        code: 'unipile_api_internal_error', details: { httpStatus: 503 } })
      return { status: 'completed' }
    }
    let c = f.create(); await c.tick(); await c.idle()
    const first = f.tasks.find(t => t.account.id === 1)!
    assert.equal(first.state, 'waiting'); assert.equal(first.runId, 'same-run')
    assert.equal(f.tasks.find(t => t.account.id === 2)?.state, 'completed')
    assert.equal(f.events.find(e => e.code === 'unipile_api_internal_error')?.httpStatus, 503)
    await c.close(); c = f.create('restarted')
    await c.tick(); await c.idle(); assert.equal(attempts, 1)
    f.advance(60_000); await c.tick(); await c.idle()
    assert.equal(f.tasks.find(t => t.account.id === 1)?.state, 'completed')
    assert.equal(attempts, 2); await c.close()
  })
}
test('cooldowns use absolute maximum deadlines across features, not accumulated delays', async () => {
  const f = fixture(), p = createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {}, onFailure() {} })
  const info = { account: 'u1', write: false, method: 'GET', operation: 'users' }
  const error = { code: 'unipile_rate_limit', details: { retryAt: noon + 3600_000, observedAt: noon, httpStatus: 429 } }
  await p.failed(info, error); f.advance(300_000); await p.failed(info, error)
  assert.equal(f.cooldowns[0].until, noon + 3600_000)
  await assert.rejects(p.before({ ...info, operation: 'posts' }), /Сохранённое ожидание/)
  await p.before({ ...info, account: 'u2' }); f.advance(3300_000); await p.before(info)
})

test('request journal names the actual stage in Russian without leaking URLs or bodies', async () => {
  const f = fixture(), p = createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {}, onFailure() {} })
  const cases = [
    ['POST', '/u1/linkedin/search/people', 'Поиск кандидатов'],
    ['GET', '/u1/users/private-person-id?private=query', 'Проверка профиля кандидата'],
    ['POST', '/u1/users/me/relation-requests', 'Отправка приглашения'],
    ['GET', '/u1/users/me/relation-requests', 'Сверка отправленных приглашений'],
    ['POST', '/u1/users/me/relation-requests/private-id/cancel', 'Отзыв приглашения'],
    ['POST', '/u1/posts/private-id/comments', 'Отправка комментария'],
    ['POST', '/u1/posts/private-id/reactions', 'Отправка лайка']
  ]
  for (const [method, path, text] of cases) {
    const info = requestInfo(method, path, { text: 'private-body' })
    await p.before(info, { taskId: 'task', feature: 'invitations' })
    assert.ok(f.events.at(-1)!.message.startsWith(text))
  }
  assert.equal(JSON.stringify(f.events).includes('private-'), false)
})

test('two Unipile bindings of the same LinkedIn ID share one cooldown', async () => {
  const f = fixture(), p = createRequestPolicy({ store: f.store, now: f.now, resolveKey: () => 'linkedin:person',
    assertOwner: async () => {}, onFailure() {} })
  await p.failed({ account: 'old', method: 'GET', operation: 'users', write: false },
    { code: 'unipile_rate_limit', details: { retryAt: noon + 60_000, httpStatus: 429 } })
  await assert.rejects(p.before({ account: 'new', method: 'POST', operation: 'posts', write: true }), { code: 'unipile_shared_cooldown' })
})

test('HTTP boundary never sends after loss of SQL ownership and records actual response deadlines', async () => {
  const f = fixture(); let owner = true, requests = 0
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now,
    sleep: async ms => f.advance(ms), random: () => 0,
    assertOwner: async () => { if (!owner) throw fail('automation_owner_lost') }, onFailure() {} }))
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++
    return new Response('{"type":"rate_limit"}', { status: 429, headers: { 'retry-after': '3600' } }) } })
  try {
    owner = false; await assert.rejects(client.request('POST', '/users/invite', { account_id: 'u1' }), { code: 'automation_owner_lost' })
    assert.equal(requests, 0); owner = true
    await assert.rejects(client.request('GET', '/users?account_id=u1'))
    assert.equal(f.cooldowns[0].account, 'u1'); assert.ok(f.cooldowns[0].until >= Date.now() + 3599_000)
    await assert.rejects(client.request('POST', '/posts', { account_id: 'u1' }), { code: 'unipile_shared_cooldown' })
    assert.equal(requests, 1)
  } finally { dispose() }
})

test('request contexts remain separate while different students run concurrently', async () => {
  const seen: string[] = []
  const dispose = installRequestPolicy({ async before(_info: any, ctx: any) { seen.push(ctx.taskId); await ctx.assertWrite() }, async failed() {} })
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => new Response('{}') })
  try { await Promise.all(['one', 'two', 'three'].map(taskId => withRequestContext({ taskId,
    assertWrite: async () => { seen.push(`allowed-${taskId}`) } }, async () => {
    await new Promise(r => setImmediate(r)); await client.request('POST', '/posts', { account_id: taskId })
  })))
  assert.deepEqual(new Set(seen), new Set(['one', 'two', 'three', 'allowed-one', 'allowed-two', 'allowed-three']))
  } finally { dispose() }
})

test('HTTP 500 pauses every feature of one account, survives restart and preserves provider diagnostics', async () => {
  const f = fixture(); f.advance(Date.now() - noon)
  let requests = 0, failure: any
  const policy = () => createRequestPolicy({ store: f.store, now: f.now, assertOwner: async () => {},
    random: () => 0, sleep: async ms => f.advance(ms), onFailure() {} })
  let dispose = installRequestPolicy(policy())
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => {
    requests++
    return requests === 1 ? new Response(JSON.stringify({ type: 'api/internal_error', req_id: 'Remote-AbC_42',
      title: 'Connector failed.', message: 'Expected a collection.',
      detail: 'Could not parse LinkedIn response. password=PRIVATE https://private.invalid', body: 'private draft' }), { status: 500 }) : new Response('{}')
  } })
  try {
    await assert.rejects(withRequestContext({ taskId: 'post-task', feature: 'posts' }, () =>
      client.request('POST', '/u1/posts', { text: 'private draft' })), (error: any) => { failure = error; return true })
    assert.equal(requests, 1)
    const error = f.events.find(e => e.httpStatus === 500)!
    assert.match(error.diagnostic!, /Unipile req_id=Remote-AbC_42/)
    assert.match(error.diagnostic!, /api\/internal_error/)
    assert.match(error.diagnostic!, /title: Connector failed\./)
    assert.match(error.diagnostic!, /message: Expected a collection\./)
    assert.match(error.diagnostic!, /detail=string/)
    assert.match(error.diagnostic!, /Could not parse LinkedIn response\./)
    assert.match(error.diagnostic!, /\/:id\/posts/)
    assert.notEqual(error.requestId, 'Remote-AbC_42')
    assert.match(error.message, /Наша пауза после сбоя сервиса/)
    assert.match(error.message, /HTTP 500/)
    assert.equal(error.stage, 'Публикация поста')
    assert.equal(failure.details.requestStage, 'post_send')
    assert.equal(error.taskId, 'post-task')
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|private\.invalid|private draft/)
    assert.equal(f.cooldowns[0].until, failure.details.observedAt + 300_000)
    const deadline = f.cooldowns[0].until
    f.advance(60_000)
    await policy().failed(requestInfo('POST', '/u1/posts'), failure)
    assert.equal(f.cooldowns[0].until, deadline, 'handling the same failure twice cannot restart the wait')
    dispose(); dispose = installRequestPolicy(policy())
    for (const path of ['/u1/users/me/relation-requests', '/u1/posts/p/comments', '/u1/posts/p/reactions']) {
      await assert.rejects(client.request('GET', path), (e: any) => e.notSent === true && e.details.retryAt === deadline)
    }
    assert.equal(requests, 1)
    await client.request('GET', '/u2/posts'); assert.equal(requests, 2, 'another account can continue')
    f.advance(deadline - f.now() - 1)
    await assert.rejects(policy().before(requestInfo('GET', '/u1/posts')))
    f.advance(1)
    await client.request('GET', '/u1/posts'); assert.equal(requests, 3, 'a read can resume at the original deadline')
  } finally { dispose() }
})

test('request audit records correlated failures and refuses a POST if its first log cannot be saved', async () => {
  const f = fixture(); let requests = 0
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now,
    sleep: async ms => f.advance(ms), random: () => 0,
    assertOwner: async () => {}, accountInfo: () => ({ accountId: 7, studentId: 107 }), onFailure() {} }))
  const client = createUnipileHttpClient({ apiKey: 'test', fetchImpl: async () => { requests++; throw new Error('lost response') } })
  try {
    await assert.rejects(client.request('POST', '/posts', { account_id: 'u' }), { code: 'unipile_unreachable' })
    assert.equal(requests, 1); assert.equal(f.events.length, 3)
    assert.deepEqual(f.events.map(e => e.code), ['request_prepared', 'request_started', 'unipile_unreachable'])
    assert.equal(new Set(f.events.map(e => e.requestId)).size, 1)
    assert.equal(f.events[2].accountId, 7); assert.equal(f.events[2].source, 'Unipile')
    f.store.event = async () => { throw fail('sql_unavailable') }
    await assert.rejects(client.request('POST', '/posts', { account_id: 'u' }), (e: any) => e.notSent === true)
    assert.equal(requests, 1)
  } finally { dispose() }
})

test('outer-cycle SQL failures survive recovery in the journal, with no repeated fallback spam', async () => {
  const f = fixture(), reports: Event[] = []
  const engine = createOrchestrator({ store: f.store, adapters: f.adapters, now: f.now,
    autoStart: false, report: event => reports.push(event) })
  try {
    await engine.tick()
    engine.suspend(fail('sql_unavailable')); engine.suspend(fail('sql_unavailable'))
    assert.equal(reports.length, 1)
    await engine.tick()
    assert.equal((await engine.status()).error, undefined)
    assert.equal(f.events.filter(e => e.code === 'sql_unavailable').length, 1)
    assert.equal(f.events[0].source, 'SQL'); assert.ok(f.events[0].stage)
  } finally { await engine.close() }
})

test('automatic read permission is checked before any provider GET', async () => {
  const f = fixture(); let requests = 0
  const dispose = installRequestPolicy(createRequestPolicy({ store: f.store, now: f.now,
    assertOwner: async () => {}, onFailure() {}, sleep: async ms => f.advance(ms) }))
  const client = createUnipileHttpClient({ apiKey: 'mock', fetchImpl: async () => { requests++; throw Error('must not call') } })
  try {
    await assert.rejects(withRequestContext({ taskId: 'old:likes', assertRequest: async () => { throw fail('automation_disabled') } },
      () => client.request('GET', '/u1/posts/p/reactions')), { code: 'automation_disabled', notSent: true })
    assert.equal(requests, 0)
  } finally { dispose() }
})

test('console bridges like domain failures into SQL with the author and distinct actors', async () => {
  const f = fixture(); let offline = false
  const save = f.store.event
  const storage = Object.assign(f.store, { withdrawals: { async load() { return undefined }, async save() {} },
    async importWithdrawal() {}, async event(event: Event) { if (offline) throw fail('sql_unavailable'); await save(event) } })
  const automation = (await prepareLinkedInAutomation(storage, { async listAccounts() { return [
    { platformAccountId: 1, clientId: 101, clientName: 'Mock author', unipileAccountId: 'u1', verifiedProviderId: 'p1' }
  ] as any } }, { now: f.now, autoStart: false, version: 'test-source' }))!
  automation.attach({ inviter: { stop() {} }, comments: { stop() {} }, posts: { async close() {} } } as any)
  try {
    const event = { runId: 'post-run', taskId: 'completed-post', authorAccountId: 1, actorAccountId: 2,
      code: 'post_identity_mismatch', stage: 'like_preflight' as const }
    automation.reportLikeEvent(event)
    automation.reportLikeEvent({ ...event, actorAccountId: 3 })
    offline = true
    await automation.tick()
    offline = false; await automation.tick()
    const events = f.events.filter(row => row.code === 'post_identity_mismatch')
    assert.equal(events.length, 2)
    assert.equal(events[0].accountId, 1); assert.equal(events[0].studentId, 101)
    assert.equal(events[0].runId, 'post-run'); assert.equal(events[0].taskId, 'completed-post')
    assert.equal(events[0].feature, 'likes'); assert.equal(events[0].stage, 'Проверка аккаунта перед лайком')
    assert.match(events[0].message, /Исполнитель: аккаунт 2/)
    assert.match(events[1].message, /Исполнитель: аккаунт 3/)
  } finally { await automation.close() }
})

test('admin API preserves server-owned account identity and reports each bulk result', async () => {
  const f = fixture(), storage = Object.assign(f.store, { withdrawals: { async load() { return undefined }, async save() {} },
    async importWithdrawal() {} })
  const accounts = [1, 2].map(id => ({ platformAccountId: id, clientId: id + 100, clientName: `Test ${id}`,
    unipileAccountId: `u${id}`, verifiedProviderId: `p${id}` }))
  const runtime = await prepareLinkedInAutomation(storage, { listAccounts: async () => accounts as any }, { now: f.now, autoStart: false })
  assert.ok(runtime)
  runtime.attach({ inviter: { stop() {} }, comments: { stop() {} }, posts: { async close() {}, async transferAutomation() {}, async stopAutomaticLikes() {} } } as any)
  await runtime.tick()
  const firstRelease = withRequestContext({ taskId: 'automatic' }, () => runtime.gate.acquire('connection_inviter', 'auto', '1'))
  assert.throws(() => runtime.gate.acquire('post_writer_automatic', 'old-scheduled-post', '1'), { code: 'linkedin_operation_active' })
  firstRelease()
  withRequestContext({ taskId: 'automatic' }, () => runtime.gate.acquire('connection_inviter', 'auto', '1'))()
  const release = withRequestContext({ taskId: 'automatic' }, () => runtime.gate.acquire('connection_inviter', 'auto', '1'))
  assert.throws(() => runtime.gate.acquire('profile_fill', 'manual', '1'), { code: 'linkedin_operation_active' })
  release()
  assert.throws(() => withRequestContext({ taskId: 'automatic' }, () => runtime.gate.acquire('connection_inviter', 'auto', '1')),
    { code: 'linkedin_operation_active' })
  runtime.gate.acquire('profile_fill', 'manual', '1')()
  const app = express(); app.use(express.json())
  runtime.routes(app, (req, res, next) => req.headers['x-test-admin'] === 'yes' ? next() : void res.status(403).end())
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>(r => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin/linkedin/automation`
  try {
    assert.equal((await fetch(base)).status, 403)
    const response = await fetch(base + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
      body: JSON.stringify({ enabled: true, slots: schedule().slots, account: { key: 'forged' }, accounts: [{ id: 1, version: 0 }, { id: 999, version: 0 }] }) })
    assert.equal(response.status, 200)
    const body = await response.json() as any
    assert.equal(body.results[0].ok, true); assert.equal(body.results[1].ok, false)
    assert.equal(f.schedules[0].account.key, 'linkedin:p1'); assert.equal(f.schedules.length, 1)
    const conflict = await fetch(base + '/schedule/1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-admin': 'yes' },
      body: JSON.stringify({ enabled: false, slots: schedule().slots, version: 0 }) })
    assert.equal(conflict.status, 409)
    const status = await fetch(base, { headers: { 'x-test-admin': 'yes' } }); assert.equal(status.status, 200)
  } finally { await runtime.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) }
})
