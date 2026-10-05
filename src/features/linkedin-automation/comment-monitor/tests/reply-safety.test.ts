import { test } from 'node:test'
import assert from 'node:assert/strict'
import { publishReplies } from '../reply-publisher.ts'
import { readVerified, reconcileUncertain, markVerified } from '../reply-verification.ts'
import type { MonitorItem, MonitorJob } from '../types.ts'
import { pollMonitorJob } from '../poll-job.ts'
import { restoreMonitorJobs } from '../restore.ts'
import { generateReplies } from '../reply-generation.ts'
import * as serviceModule from '../service.ts'
const { createCommentMonitorService } = (serviceModule as any).default ?? serviceModule

const start = Date.parse('2026-09-28T10:00:00Z')

test('managed Stop cannot hide a 20 minute local expiry behind a two-hour provider wait', async () => {
  const f = fixture(); f.job.state.automationId = 'auto'
  f.item.status = 'uncertain'; f.item.attemptedAt = new Date(start).toISOString()
  f.item.recovery = { firstFailedAt: start, httpStatus: 500, stage: 'comments_read' }
  f.job.state.providerNotBefore = new Date(start + 7200_000).toISOString()
  let saved = structuredClone(f.job)
  const service = createCommentMonitorService({ ...f.options, autoStart: false, openai: {}, repository: {},
    loggerFor: () => f.options.logger, store: { async list() { return [structuredClone(saved)] },
      async update(value: MonitorJob) { saved = structuredClone(value) }, async purge() {} } })
  try {
    const stopped = await service.stepManaged(f.job.jobId, true)
    assert.equal(stopped.recoveryDeadlineAt, start + 20 * 60_000)
    f.time(start + 20 * 60_000)
    const result = await service.stepManaged(f.job.jobId, true)
    assert.equal(result.status, 'stopped'); assert.equal(result.skippedActions.length, 1)
    assert.equal(saved.state.items[0].status, 'uncertain')
    assert.equal(saved.state.items[0].recovery?.skippedAt, start + 20 * 60_000)
    assert.deepEqual(f.counts(), { posts: 0, reads: 0 })
  } finally { service.stop() }
})

test('a 500 POST starts the budget even when its following read-back fails differently', async () => {
  const f = fixture()
  f.adapter.reply = async () => { throw Object.assign(Error('server'), { code: 'unipile_http_500', details: { httpStatus: 500 } }) }
  f.adapter.listReplies = async () => { throw Object.assign(Error('timeout'), { code: 'unipile_timeout' }) }
  await assert.rejects(publishReplies(f.options))
  assert.equal(f.item.recovery?.firstFailedAt, start); assert.equal(f.item.recovery?.httpStatus, 500)
})

test('generation 500 expires for the failed comment batch; the next queued reply still sends', async () => {
  const f = fixture(); f.job.createdAt = new Date(start).toISOString(); f.job.state.posts = []
  f.item.status = 'detected'; f.item.incomingText = 'How do reliable retries work?'
  await assert.rejects(generateReplies({ ...f.options, openai: { async generate() {
    throw Object.assign(Error('model'), { code: 'openai_request_failed', details: { httpStatus: 500 } })
  } } }))
  assert.equal(f.item.recovery?.source, 'OpenAI')
  const restored = structuredClone(f.job)
  const next = { ...f.item, recovery: undefined, status: 'queued' as const, incomingId: 'next', parentId: 'next', threadId: 'next' }
  restored.state.items.push(next)
  f.adapter.listReplies = async () => ({ data: [{ id: 'sent', is_sender: true }] })
  f.time(start + 20 * 60_000)
  await pollMonitorJob({ ...f.options, job: restored, store: { async update() {} }, openai: {} })
  assert.equal(restored.state.items[0].status, 'failed'); assert.equal(restored.state.failed, 1)
  assert.equal(next.status, 'verified'); assert.equal(f.counts().posts, 1)
})

test('500 recovery expires for one reply; durable unknown still reserves quota and next reply continues', async () => {
  const f = fixture(); f.job.createdAt = new Date(start).toISOString(); f.job.state.posts = []
  f.adapter.listReplies = async () => { throw Object.assign(Error('server'), {
    code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } }) }
  await assert.rejects(publishReplies(f.options))
  const restored = structuredClone(f.job)
  const second = { ...f.item, recovery: undefined, replyId: undefined, attemptedAt: undefined,
    incomingId: 'second', parentId: 'second', threadId: 'second', status: 'queued' as const }
  restored.state.items.push(second)
  f.adapter.listReplies = async (...args: any[]) => {
    assert.equal(args[2], 'second', 'expired reply must not be read again')
    return { data: [{ id: 'sent', is_sender: true }] }
  }
  f.time(start + 20 * 60_000)
  await pollMonitorJob({ ...f.options, job: restored, store: { async update() {} }, openai: {} })
  assert.equal(restored.state.items[0].status, 'uncertain')
  assert.equal(restored.state.items[0].recovery?.skippedAt, start + 20 * 60_000)
  assert.equal(second.status, 'verified'); assert.equal(restored.state.published, 1)
  assert.equal(f.counts().posts, 2)
})

test('disabled read-back preserves Retry-After without resuming discovery or sending', async () => {
  const f = fixture(); await assert.rejects(publishReplies(f.options)); f.job.status = 'disabled'
  f.time(start + 60_000); let reads = 0
  const deadline = start + 2 * 3600_000
  f.adapter.listReplies = async () => { reads++; throw Object.assign(Error('limited'), {
    code: 'unipile_rate_limit', details: { httpStatus: 429, retryAt: deadline } }) }
  const options = { ...f.options, store: { async update() {} }, openai: {} }
  assert.equal((await pollMonitorJob(options)).status, 'verifying')
  assert.equal(f.job.status, 'disabled'); assert.equal(Date.parse(f.job.nextCheckAt!), deadline)
  f.time(deadline - 1); await pollMonitorJob(options); assert.equal(reads, 1)
  f.adapter.listReplies = async () => { reads++; return { data: [{ id: 'sent', is_sender: true }] } }
  f.time(deadline); await pollMonitorJob(options); await pollMonitorJob(options)
  assert.equal(reads, 2); assert.equal(f.job.state.published, 1); assert.equal(f.counts().posts, 1)
  assert.equal(f.job.status, 'disabled')
})

test('one uncertain reply reserves quota while another thread continues without repeating either POST', async () => {
  const f = fixture()
  f.job.createdAt = new Date(start).toISOString()
  const second = { ...f.item, incomingId: 'second', parentId: 'other-parent', threadId: 'other-parent' }
  f.job.state.items.push(second)
  const store = { async update() {} }
  const options = { ...f.options, store, openai: {}, random: () => 0 }
  const first = await pollMonitorJob(options)
  assert.equal(f.item.status, 'uncertain'); assert.equal(f.counts().posts, 1)
  f.adapter.listReplies = async (...args: any[]) => ({ data: args[2] === 'other-parent' ? [{ id: 'sent', is_sender: true }] : [] })
  for (let i = 0; i < 3 && second.status !== 'verified'; i++) {
    f.time(Date.parse(f.job.nextCheckAt!)); await pollMonitorJob(options)
  }
  assert.equal(second.status, 'verified'); assert.equal(f.counts().posts, 2)
  assert.equal(f.job.state.published, 1); assert.equal(f.item.status, 'uncertain')
  assert.equal(first.status, 'verifying')
})

test('unknown replies occupy the remaining session quota and a provider deadline prevents all requests', async () => {
  const f = fixture(); f.job.createdAt = new Date(start).toISOString(); f.job.state.published = 29
  f.item.status = 'uncertain'; f.item.nextVerificationAt = new Date(start + 3600_000).toISOString()
  f.job.state.items.push({ ...f.item, incomingId: 'other', status: 'queued' })
  const options = { ...f.options, store: { async update() {} }, openai: {} }
  await pollMonitorJob(options)
  assert.deepEqual(f.counts(), { posts: 0, reads: 0 })
  f.job.state.published = 0; f.job.state.providerNotBefore = new Date(start + 7200_000).toISOString()
  await pollMonitorJob(options)
  assert.equal(f.job.nextCheckAt, f.job.state.providerNotBefore)
  assert.deepEqual(f.counts(), { posts: 0, reads: 0 })
})

test('restart keeps independent work due before an old verification, but never before provider cooldown', async () => {
  const f = fixture()
  f.item.status = 'uncertain'; f.item.nextVerificationAt = new Date(start + 7200_000).toISOString()
  f.job.state.nextWorkAt = new Date(start + 45_000).toISOString()
  const restore = async () => {
    const jobs = new Map<string, MonitorJob>()
    await restoreMonitorJobs({ jobs, now: () => start, store: { async list() { return [structuredClone(f.job)] }, async purge() {} },
      loggerFor: () => f.options.logger, save: async job => { jobs.set(job.jobId, job) } })
    return jobs.get(f.job.jobId)!
  }
  assert.equal((await restore()).nextCheckAt, f.job.state.nextWorkAt)
  f.job.state.providerNotBefore = new Date(start + 10800_000).toISOString()
  assert.equal((await restore()).nextCheckAt, f.job.state.providerNotBefore)
})

test('known ID stops on its first page; absent ID still checks all pages', async () => {
  const f = fixture(); f.item.replyId = 'sent'; let reads = 0
  f.adapter.listReplies = async (...args: any[]) => {
    reads++
    return args[4] ? { data: [], next_cursor: null } :
      { data: [{ id: 'sent', is_sender: true }], next_cursor: 'page2' }
  }
  assert.equal((await readVerified(f.options, f.item))?.id, 'sent'); assert.equal(reads, 1)
  f.item.replyId = 'absent'
  assert.equal(await readVerified(f.options, f.item), undefined); assert.equal(reads, 3)
})

test('invisible new reply is read once, then waits for the saved verification deadline', async () => {
  const f = fixture()
  await assert.rejects(publishReplies(f.options), { code: 'comment_reply_uncertain' })
  assert.deepEqual(f.counts(), { posts: 1, reads: 1 })
  await reconcileUncertain(f.options)
  assert.deepEqual(f.counts(), { posts: 1, reads: 1 })
  f.time(start + 60_000); await reconcileUncertain(f.options)
  assert.deepEqual(f.counts(), { posts: 1, reads: 2 })
})

test('executor loss and a failed checkpoint do not turn a resumable session into a terminal error', async () => {
  for (const cause of ['automation_owner_lost', 'storage']) {
    const f = fixture(); let held = false
    await assert.rejects(pollMonitorJob({ ...f.options, store: { async update() { throw new Error('storage down') } },
      openai: { async generate() { throw new Error('must not generate') } }, gate: { acquire() {
        if (cause === 'automation_owner_lost') throw Object.assign(new Error('lost'), { code: cause })
        held = true; return () => { held = false }
      } } }), { code: cause === 'storage' ? 'comment_monitor_persistence_unavailable' : cause })
    assert.notEqual(f.job.status, 'error'); assert.equal(held, false); assert.equal(f.counts().posts, 0)
  }
})
function fixture() {
  let time = start, posts = 0, reads = 0, saved: any
  const item: MonitorItem = { incomingId: 'incoming', postId: 'post', parentId: 'parent',
    threadId: 'parent', incomingText: 'Hi', threadText: 'Hi', replyText: 'Thanks', status: 'queued',
    createdAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString() }
  const job = { jobId: 'job', accountId: 'account', platformAccountId: 1, status: 'replying',
    expiresAt: new Date(start + 86_400_000).toISOString(), state: { items: [item], published: 0,
      failed: 0, threadReplies: {} } } as MonitorJob
  const adapter = { reply: async () => { posts++; return { id: 'sent' } },
    listReplies: async (..._args: any[]): Promise<any> => { reads++; return { data: [] } } }
  const options = { job, items: [item], adapter, logger: { event() {} }, now: () => time,
    sleep: async () => {}, save: async () => { saved = structuredClone(job) } }
  return { item, job, adapter, options, time: (value: number) => time = value,
    counts: () => ({ posts, reads }), saved: () => saved }
}

for (const code of ['unipile_api_too_many_requests', 'unipile_http_500', 'unipile_timeout']) {
  test(`POST then ${code} during verification never sends twice`, async () => {
    const f = fixture()
    f.adapter.listReplies = async () => { throw Object.assign(new Error(code), {
      code, details: { retryAfterMs: 900_000 } }) }
    await assert.rejects(publishReplies(f.options))
    assert.equal(f.saved().state.items[0].replyId, 'sent')
    assert.equal(f.item.status, 'uncertain')
    assert.equal(Date.parse(f.item.nextVerificationAt!), start + 900_000)
    await publishReplies(f.options)
    f.time(start + 900_000)
    f.adapter.listReplies = async () => ({ data: [{ id: 'sent', is_sender: true }] })
    await reconcileUncertain(f.options)
    await reconcileUncertain(f.options)
    markVerified(f.job, f.item, { id: 'sent' }, f.options.logger)
    assert.equal(f.counts().posts, 1)
    assert.equal(f.job.state.published, 1)
    assert.equal(f.job.state.threadReplies.parent, 1)
  })
}

test('without ID only one own reply with a usable attempt time confirms', async () => {
  const f = fixture(); f.item.attemptedAt = new Date(start).toISOString()
  const row = { id: 'sent', text: 'Thanks', is_sender: true }
  for (const rows of [[row], [{ ...row, created_at: new Date(start - 1).toISOString() }],
    [1, 2].map(id => ({ ...row, id: String(id), created_at: new Date(start).toISOString() }))]) {
    f.adapter.listReplies = async () => ({ data: rows })
    assert.equal(await readVerified(f.options, f.item), undefined)
  }
  f.adapter.listReplies = async () => ({ data: [{ ...row, created_at: new Date(start).toISOString() }] })
  assert.equal((await readVerified(f.options, f.item))?.id, 'sent')
  f.item.replyId = 'different-id'
  assert.equal(await readVerified(f.options, f.item), undefined)
})

test('failed durable intent prevents POST; failed ID save preserves known ID', async () => {
  const f = fixture(); let saves = 0
  f.options.save = async () => { if (++saves === 1) throw new Error('storage down') }
  await assert.rejects(publishReplies(f.options)); assert.equal(f.counts().posts, 0)
  const g = fixture(); saves = 0
  g.options.save = async () => { if (++saves === 2) throw new Error('storage down') }
  await assert.rejects(publishReplies(g.options))
  assert.equal(g.item.replyId, 'sent'); assert.equal(g.counts().reads, 0)
  await publishReplies(g.options); assert.equal(g.counts().posts, 1)
})

test('unknown survives negative reads with durable increasing verification intervals', async () => {
  const f = fixture()
  await assert.rejects(publishReplies(f.options))
  for (let minute = 1; minute <= 10; minute++) {
    assert.equal(Date.parse(f.item.nextVerificationAt!), start + minute * 60_000)
    f.time(start + minute * 60_000); await reconcileUncertain(f.options)
  }
  let due = start + 25 * 60_000
  for (const delay of [30, 60, 60]) {
    assert.equal(Date.parse(f.item.nextVerificationAt!), due)
    f.time(due); await reconcileUncertain(f.options); due += delay * 60_000
  }
  assert.equal(f.item.status, 'uncertain'); assert.equal(f.job.state.failed, 0)
})

for (const status of ['disabled', 'completed'] as const) {
  test(`restart of ${status} monitor checks the saved ID after the deadline without a new reply`, async () => {
    const f = fixture()
    await assert.rejects(publishReplies(f.options))
    f.job.status = status
    f.job.expiresAt = new Date(start - 1).toISOString()
    const jobs = new Map<string, MonitorJob>()
    const store = { list: async () => [structuredClone(f.job)], update: async () => {} }
    await restoreMonitorJobs({ store, jobs, loggerFor: () => f.options.logger, save: async () => {}, now: () => start })
    const job = jobs.get('job')!
    assert.equal(job.state.items[0].nextVerificationAt, new Date(start + 60_000).toISOString())
    let reads = 0
    f.adapter.listReplies = async () => { reads++; return { data: [{ id: 'sent', is_sender: true }] } }
    await pollMonitorJob({ ...f.options, job, store, openai: {} })
    assert.equal(reads, 0)
    f.time(start + 60_000)
    await pollMonitorJob({ ...f.options, job, store, openai: {} })
    assert.equal(job.state.published, 1); assert.equal(job.status, status)
    assert.equal(f.counts().posts, 1)
  })
}

test('one monitor step sends one reply and releases the account during the saved pause', async () => {
  const f = fixture()
  f.job.createdAt = new Date(start).toISOString(); f.job.state.posts = []
  f.job.state.items.push({ ...f.item, incomingId: 'second' })
  f.adapter.listReplies = async () => ({ data: [{ id: 'sent', is_sender: true }] })
  let held = false
  const options = { ...f.options, store: { update: async () => {} }, openai: {}, random: () => 0,
    gate: { acquire() { assert.equal(held, false); held = true; return () => held = false } } }
  const first = await pollMonitorJob(options)
  assert.equal(first.status, 'waiting'); assert.equal(f.counts().posts, 1); assert.equal(held, false)
  assert.equal(Date.parse(first.nextActionAt!), start + 45_000)
  f.time(Date.parse(first.nextActionAt!)); await pollMonitorJob(options)
  assert.equal(f.counts().posts, 2); assert.equal(f.job.state.published, 2)
})

test('disable while saving intent prevents the POST', async () => {
  const f = fixture()
  f.options.save = async () => { f.job.status = 'disabled' }
  await publishReplies(f.options)
  assert.equal(f.counts().posts, 0); assert.equal(f.item.status, 'ignored')
})

for (const committed of [false, true]) test(`verification save lost, committed=${committed}: restart counts once`, async () => {
  const f = fixture(); let stored: MonitorJob | undefined, saves = 0
  f.adapter.listReplies = async () => ({ data: [{ id: 'sent', is_sender: true }] })
  f.options.save = async () => {
    saves++
    if (saves !== 3 || committed) stored = structuredClone(f.job)
    if (saves === 3) throw new Error('lost commit response')
  }
  await assert.rejects(publishReplies(f.options))
  const restored = stored!
  await reconcileUncertain({ ...f.options, job: restored, save: async () => {} })
  await reconcileUncertain({ ...f.options, job: restored, save: async () => {} })
  assert.equal(restored.state.published, 1); assert.equal(restored.state.threadReplies.parent, 1)
  assert.equal(f.counts().posts, 1)
})
