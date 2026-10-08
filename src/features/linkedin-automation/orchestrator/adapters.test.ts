import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConnectionInviterService } from '../connection-inviter/service.ts'
import { fixture as connectionFixture } from '../connection-inviter/tests/fixtures.ts'
import { fixture as withdrawalFixture } from '../invitation-withdrawal/test-fixture.ts'
import { createInvitationWithdrawal } from '../invitation-withdrawal/service.ts'
import { fixture as postFixture } from '../post-writer/tests/helpers.ts'
import * as commentModule from '../comment-monitor/service.ts'
import { defaults } from '../post-writer/types.ts'
const { createCommentMonitorService } = (commentModule as any).default ?? commentModule

test('managed withdrawal resumes the saved queue after Stop and restart, with no request during resume', async () => {
  const f = withdrawalFixture(); let now = f.runtime.now(); f.runtime.now = () => now
  let service = createInvitationWithdrawal(f.runtime)
  await service.startAutomatic!(1, 'saved-slot')
  const step = await service.stepManaged!(1, 'saved-slot')
  assert.equal(f.calls.length, 1)
  await service.stepManaged!(1, 'saved-slot', true)
  service = createInvitationWithdrawal(f.runtime)
  await service.resumeManaged!(1, 'saved-slot')
  assert.equal(f.calls.length, 1)
  for (let i = 0; i < 15; i++) {
    const result = await service.stepManaged!(1, 'saved-slot')
    if (result.nextActionAt) now = Math.max(now, Date.parse(result.nextActionAt))
    if (result.status === 'completed') break
  }
  assert.deepEqual(f.calls, ['1', '2'])
  assert.equal((await service.status(1))?.status, 'completed')
  assert.equal((await service.status(1))?.total, 2)
})

test('managed post resumes a saved unknown result by ID, preserving its verification deadline', async () => {
  const f = postFixture(), run = await f.service.prepareManaged(203, '2026-09-07', 'task')
  const saved = await f.deps.store.get('runs', run.id)
  const due = f.deps.now() + 60_000
  Object.assign(saved!, { status: 'uncertain', stop: true, attemptedAt: f.deps.now(), postId: 'known-id', nextActionAt: due })
  await f.deps.store.put('runs', run.id, saved!); await f.service.close(); f.restart()
  await f.service.resumeManaged(run.id)
  const resumed = await f.deps.store.get('runs', run.id)
  assert.equal(resumed?.stop, false); assert.equal(resumed?.postId, 'known-id')
  assert.equal(resumed?.nextActionAt, due); assert.equal(resumed?.status, 'uncertain')
  await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 0)
  await f.service.close()
})

test('Inviter preparation cannot send; managed steps keep quota and survive restarting between candidates', async () => {
  const f = connectionFixture({ stack: 'GO', connectionCount: 149 })
  let now = Date.parse('2026-09-28T10:00:00+03:00'), held = false
  const options = { ...f, autoRecover: false, enforceWriterSingleton: false,
    now: () => new Date(now), random: () => 0,
    sleep: async (ms: number) => { now += ms }, gate: { acquire() {
      assert.equal(held, false); held = true; return () => { held = false } } } }
  let service = createConnectionInviterService(options)
  const run = await service.start(7, {}, 'task-1')
  assert.equal(f.metrics.sends, 0)
  let step, restarted = false
  for (let i = 0; i < 150; i++) {
    step = await service.stepManaged(run.runId)
    assert.equal(held, false)
    if (!restarted && Number(f.metrics.sends) === 1) {
      service.stop(); await new Promise(r => setImmediate(r)); restarted = true
      service = createConnectionInviterService(options)
      await service.recover(); assert.equal(f.metrics.sends, 1)
    }
    if (step.nextActionAt) now = Math.max(now, Date.parse(step.nextActionAt))
    if (['completed', 'needs_attention', 'stopped'].includes(step.status)) break
  }
  assert.equal(step?.status, 'completed')
  const final = await f.store.getRun(run.runId)
  assert.equal(f.metrics.sends, final?.dailyQuota)
  const sent = (await f.store.listRunHistory(run.runId, 1000)).filter(h => h.status === 'sent')
  assert.equal(new Set(sent.map(h => h.personId)).size, sent.length)
  service.stop()
})

test('one invisible invitation reserves quota but other recipients continue, including after restart', async () => {
  const f = connectionFixture({ stack: 'GO', connectionCount: 149, confirmedReceipts: true })
  let now = Date.parse('2026-09-28T10:00:00+03:00'), unknown = '', sends: string[] = [], restarted = false
  const send = f.adapter.sendInvitation
  f.adapter.sendInvitation = async (account: string, person: string) => {
    sends.push(person)
    if (!unknown) { unknown = person; return { request_id: 'invisible' } }
    return send(account, person)
  }
  const options = { ...f, autoRecover: false, enforceWriterSingleton: false,
    now: () => new Date(now), random: () => 0, sleep: async (ms: number) => { now += ms } }
  let service = createConnectionInviterService(options)
  const run = await service.start(7, {}, 'unknown-reservation')
  for (let i = 0; i < 100; i++) {
    const step = await service.stepManaged(run.runId)
    const saved = await f.store.getRun(run.runId)
    if (!restarted && sends.length === 1) {
      await service.stepManaged(run.runId, true); service.stop()
      service = createConnectionInviterService(options); await service.resumeManaged(run.runId); restarted = true
    }
    if (sends.length === saved?.dailyQuota) break
    if (step.nextActionAt) now = Math.max(now, Date.parse(step.nextActionAt))
  }
  const saved = (await f.store.getRun(run.runId))!
  assert.equal(sends.length, saved.dailyQuota)
  assert.equal(saved.counters.sent, saved.dailyQuota! - 1)
  assert.equal(new Set(sends).size, sends.length)
  assert.equal(Object.keys(saved.searchProgress.reservedInvitations ?? {}).length, 1)
  const count = sends.length
  for (let i = 0; i < 3; i++) {
    const step = await service.stepManaged(run.runId)
    if (step.nextActionAt) now = Math.max(now, Date.parse(step.nextActionAt))
  }
  assert.equal(sends.length, count)
  await service.stepManaged(run.runId, true); service.stop()
})

test('Inviter cooperative checkpoints retain caches and the same recipients as a continuous run', async () => {
  async function execute(managed: boolean) {
    const f = connectionFixture({ stack: 'GO', connectionCount: 149 })
    let now = Date.parse('2026-09-28T10:00:00+03:00'), yields = 0
    const calls: Record<string, number> = {}
    for (const [key, original] of Object.entries(f.adapter)) if (typeof original === 'function')
      f.adapter[key] = (...args: any[]) => { calls[key] = (calls[key] ?? 0) + 1; return (original as Function)(...args) }
    const service = createConnectionInviterService({ ...f, autoRecover: false, enforceWriterSingleton: false,
      now: () => new Date(now), random: () => 0, sleep: async ms => { now += ms } })
    const run = await service.start(7, {}, managed ? 'task' : undefined)
    if (managed) for (let i = 0; i < 200; i++) {
      const result = await service.stepManaged(run.runId, false, async action => { yields++; return action() })
      if (result.nextActionAt) now = Math.max(now, Date.parse(result.nextActionAt))
      if (['completed', 'stopped', 'needs_attention'].includes(result.status)) break
    }
    else for (let i = 0; i < 200; i++) {
      if ((await f.store.getRun(run.runId))?.status !== 'running') break
      await new Promise(r => setImmediate(r))
    }
    const final = await f.store.getRun(run.runId), recipients = (await f.store.listRunHistory(run.runId, 1000))
      .filter(h => h.status === 'sent').map(h => h.personId)
    assert.equal(final?.status, 'succeeded'); service.stop()
    return { calls, recipients, yields }
  }
  const manual = await execute(false), managed = await execute(true)
  assert.deepEqual(managed.recipients, manual.recipients)
  assert.equal(managed.calls.getAccount, manual.calls.getAccount)
  assert.ok(managed.calls.listPendingInvitations <= manual.calls.listPendingInvitations + 1,
    JSON.stringify({ manual: manual.calls, managed: managed.calls }))
  assert.ok(managed.yields > 0)
})

test('automatic withdrawal uses the same 14-day rule and continues the saved approved queue', async () => {
  const f = withdrawalFixture(); let now = f.runtime.now(); f.runtime.now = () => now
  let service = createInvitationWithdrawal(f.runtime)
  await service.startAutomatic!(1, 'slot-1'); assert.equal(f.calls.length, 0)
  let step = await service.stepManaged!(1, 'slot-1')
  assert.equal(f.calls.length, 1)
  service = createInvitationWithdrawal(f.runtime)
  for (let i = 0; i < 12 && step.status !== 'completed'; i++) {
    if (step.nextActionAt) now = Math.max(now, Date.parse(step.nextActionAt))
    step = await service.stepManaged!(1, 'slot-1')
  }
  assert.equal(step.status, 'completed'); assert.deepEqual(f.calls, ['1', '2'])
  assert.equal((await service.status(1))?.withdrawn, 2)
  await service.startAutomatic!(1, 'slot-1'); assert.equal(f.calls.length, 2)
})

test('automatic withdrawal yields a full provider wait without sleeping or canceling again', async () => {
  const f = withdrawalFixture(); let now = f.runtime.now(); f.runtime.now = () => now
  let once = true; f.provider.verify = async () => { if (once) { once = false
    throw Object.assign(new Error('rate limit'), { code: 'unipile_rate_limit', details: { httpStatus: 429, retryAt: now + 3600_000 } }) } }
  await f.service.startAutomatic!(1, 'slot'); const wait = await f.service.stepManaged!(1, 'slot')
  assert.equal(wait.status, 'waiting'); assert.equal(f.delays.length, 0); assert.equal(f.calls.length, 0)
  await assert.rejects(createInvitationWithdrawal(f.runtime).startAutomatic!(1, 'another-slot'),
    (error: any) => error.code === 'withdrawal_cooldown' && error.nextAt === now + 3600_000)
  now += 3600_000
  const next = await createInvitationWithdrawal(f.runtime).stepManaged!(1, 'slot')
  assert.equal(next.status, 'ready'); assert.deepEqual(f.calls, ['1'])
})

test('managed posts preserve daily key, separate generation from publishing and disable the old scheduler', async () => {
  const f = postFixture(); await f.service.transferAutomation(203)
  const date = '2026-09-07', run = await f.service.prepareManaged(203, date, 'task')
  assert.equal(f.counts.publish, 0)
  await f.step(); assert.equal(f.counts.publish, 0)
  await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 0)
  for (let i = 0; i < 5 && !f.counts.publish; i++) await f.service.stepManaged(run.id)
  assert.equal(f.counts.publish, 1)
  assert.equal((await f.service.prepareManaged(203, date, 'another-task')).id, run.id)
  await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 1)
  assert.equal((await f.service.get(203)).settings.automationManaged, true)
  await f.service.close()
})

test('managed post Stop preserves its ID without read-back across restart and a later day', async () => {
  const f = postFixture(), run = await f.service.prepareManaged(203, '2026-09-07', 'task')
  const saved = await f.deps.store.get('runs', run.id)
  Object.assign(saved!, { status: 'uncertain', attemptedAt: f.deps.now(), postId: 'known-id' })
  await f.deps.store.put('runs', run.id, saved!)
  await f.service.close(); f.restart()
  let reads = 0
  f.deps.adapter.read = async () => { reads++; throw Error('provider offline') }
  const stopped = await f.service.stepManaged(run.id, true)
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.summary?.unconfirmed, 1)
  await f.service.close(); f.restart()
  f.setNow(f.deps.now() + 2 * 86400_000)
  assert.equal((await f.service.stepManaged(run.id)).status, 'stopped')
  assert.equal(reads, 0); assert.equal(f.counts.publish, 0)
  assert.equal((await f.deps.store.get('runs', run.id))?.postId, 'known-id')
  await f.service.close()
})

test('missing prepared text generates only when selected, preserving manual settings and the daily key', async () => {
  const f = postFixture()
  await f.service.update(203, { ...defaults(203), contentMode: 'prepared', preparedPosts: [] })
  await assert.rejects(f.service.prepareManaged(203, '2026-09-07', 'post-task',
    { contentMode: 'prepared', generateIfMissing: false }), { code: 'post_prepared_missing' })
  const policy = { contentMode: 'prepared' as const, generateIfMissing: true }
  const run = await f.service.prepareManaged(203, '2026-09-07', 'post-task', policy)
  assert.equal(run.preparedPost, undefined)
  assert.equal((await f.service.get(203)).settings.contentMode, 'prepared')
  for (let i = 0; i < 5 && !f.counts.publish; i++) await f.service.stepManaged(run.id)
  assert.equal(f.counts.publish, 1)
  assert.equal((await f.service.prepareManaged(203, '2026-09-07', 'post-task', policy)).id, run.id)
  assert.equal(f.counts.publish, 1); await f.service.close()
})

test('an old uncertain publication is retained but cannot block preparing the next daily post forever', async () => {
  const f = postFixture(), old = await f.service.start(203, 'automatic', 'old-post')
  await f.step()
  await assert.rejects(f.service.prepareManaged(203, '2026-09-07', 'today'), { code: 'linkedin_operation_active' })
  f.setNow(f.deps.now() + 86400_000)
  const next = await f.service.prepareManaged(203, '2026-09-08', 'tomorrow')
  assert.notEqual(next.id, old.id); assert.equal(f.counts.publish, 1)
  const saved = await f.deps.store.get('runs', old.id)
  assert.ok(saved?.attemptedAt); assert.ok(saved?.postId)
  assert.equal(f.counts.publish, 1); await f.service.close()
})

test('managed inviter resumes a stopped, uninitialized quota using the same daily run', async () => {
  const f = connectionFixture({ stack: 'GO', connectionCount: 149 })
  const service = createConnectionInviterService({ ...f, autoRecover: false, enforceWriterSingleton: false,
    now: () => new Date('2026-09-28T10:00:00+03:00'), sleep: async () => undefined })
  const run = await service.start(7, {}, 'same-task')
  assert.equal((await service.stepManaged(run.runId, true)).status, 'stopped')
  await service.resumeManaged(run.runId)
  assert.equal((await f.store.getRun(run.runId))?.searchProgress.automationId, 'same-task')
  assert.equal((await service.stepManaged(run.runId)).status, 'ready')
  assert.equal(f.metrics.sends, 0)
  await service.stepManaged(run.runId, true); service.stop()
})

test('lost ownership closes the inviter step but recovery reconstructs its saved continuation', async () => {
  const f = connectionFixture({ stack: 'GO', connectionCount: 149 })
  let occupied = true, now = Date.parse('2026-09-28T10:00:00+03:00')
  const service = createConnectionInviterService({ ...f, autoRecover: false, enforceWriterSingleton: false,
    now: () => new Date(now), sleep: async ms => { now += ms }, gate: { acquire() {
      if (occupied) throw Object.assign(new Error('lost lease'), { code: 'automation_owner_lost' })
      return () => undefined
    } } })
  const run = await service.start(7, {}, 'busy-task')
  await assert.rejects(service.stepManaged(run.runId), { code: 'automation_owner_lost' })
  occupied = false; now += 90_000
  assert.equal((await service.stepManaged(run.runId)).status, 'ready')
  assert.equal((await f.store.getRun(run.runId))?.status, 'running')
  await service.stepManaged(run.runId, true); service.stop()
})

test('shared gate rejection before POST releases its intent and permits exactly one later publication', async () => {
  const f = postFixture(), publish = f.deps.adapter.publish; let rejected = false
  f.deps.adapter.publish = async (...args) => {
    if (!rejected) { rejected = true; throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active', notSent: true }) }
    return publish(...args)
  }
  await f.service.transferAutomation(203)
  const run = await f.service.prepareManaged(203, '2026-09-07', 'task')
  await f.service.stepManaged(run.id); await f.service.stepManaged(run.id)
  assert.equal(f.counts.publish, 0); assert.equal((await f.run()).publicationNotSent, true)
  f.setNow(f.deps.now() + 15_000)
  await f.service.stepManaged(run.id); assert.equal(f.counts.publish, 1)
  f.setNow(f.deps.now() + 6000); await f.service.stepManaged(run.id)
  assert.equal((await f.run()).status, 'published'); assert.equal(f.counts.publish, 1); await f.service.close()
})

test('unknown likes yield the actor between checks without another like POST', async () => {
  const f = postFixture(); await f.service.close(); f.deps.unknownLockGraceMs = 600_000; f.restart()
  await f.service.update(203, { ...defaults(203), likes: true })
  f.deps.adapter.reacted = async () => false
  await f.service.start(203, 'automatic', 'unknown-like')
  for (let i = 0; i < 10 && !f.counts.like; i++) await f.step(6000)
  await f.step(6000)
  const actor = (await f.run()).engagement.items.find(i => i.status === 'uncertain')!
  assert.ok(actor); assert.equal(f.held.has(String(actor.account.platformAccountId)), false)
  await f.step(600_000); assert.equal(f.held.has(String(actor.account.platformAccountId)), false)
  f.restart(); await f.step(600_000); assert.equal(f.counts.like, 1)
  assert.equal(f.held.has(String(actor.account.platformAccountId)), false); await f.service.close()
})

test('managed comments have no hidden timer and respect the original 48-hour cap', async () => {
  let now = Date.parse('2026-09-28T10:00:00Z'), checks = 0
  const records = new Map<string, any>()
  const store = { async list() { return [...records.values()].map(j => structuredClone(j)) },
    async get(id: string) { return structuredClone(records.get(id)) }, async create(j: any) { records.set(j.jobId, structuredClone(j)) },
    async update(j: any) { records.set(j.jobId, structuredClone(j)) }, async purge() {} }
  const options = { autoStart: false, store, now: () => now, loggerFor: () => ({ event() {} }),
    repository: { listAccounts: async () => [{ platformAccountId: 1, unipileAccountId: 'u', clientName: 'Test',
      unipileAccountStatus: 'running', lastVerifiedAt: 'verified', verifiedProviderId: 'p' }] },
    adapter: { getAccount: async () => ({ user_id: 'p' }), listPosts: async () => ({ items: [{ id: 'post', text: 'Text' }] }),
      listComments: async () => { checks++; return { items: [] } } }, openai: {}, random: () => 0 }
  let service = createCommentMonitorService(options)
  const job = await service.prepareManaged(1, 'auto'); await service.tick(); assert.equal(checks, 0)
  await service.stepManaged(job.jobId); assert.equal(checks, 1)
  service.stop(); const stored = records.get(job.jobId); stored.state.published = 30; stored.status = 'completed'
  service = createCommentMonitorService(options)
  assert.equal((await service.prepareManaged(1, 'auto')).jobId, job.jobId)
  assert.equal((await service.stepManaged(job.jobId)).nextActionAt, job.expiresAt)
  now = Date.parse(job.expiresAt) + 1
  const next = await service.prepareManaged(1, 'auto'); assert.notEqual(next.jobId, job.jobId)
  service.stop()
  const uncertain = records.get(next.jobId)
  uncertain.state.items = [{ commentId: 'original', postId: 'post', status: 'uncertain', replyId: 'saved-reply' }]
  records.set(next.jobId, uncertain)
  service = createCommentMonitorService(options)
  const before = checks
  assert.equal((await service.stepManaged(next.jobId, true)).status, 'stopped')
  service.stop(); service = createCommentMonitorService(options)
  assert.equal((await service.stepManaged(next.jobId)).status, 'stopped')
  assert.equal(records.get(next.jobId).state.items[0].replyId, 'saved-reply')
  assert.equal(checks, before); service.stop()
  // A new daily task may work, but must not inherit permission to poll stopped replies.
  const recordsCopy = new Map([...records].map(([id, value]) => [id, structuredClone(value)]))
  service = createCommentMonitorService(options)
  const replacement = await service.prepareManaged(1, 'new-day')
  assert.notEqual(replacement.jobId, next.jobId)
  assert.equal(records.get(replacement.jobId).state.items[0].replyId, 'saved-reply')
  assert.equal(records.get(replacement.jobId).state.items[0].verificationStopped, true)
  service.stop(); records.clear(); for (const [id, value] of recordsCopy) records.set(id, value)
  service = createCommentMonitorService(options)
  await service.resumeManaged(next.jobId)
  assert.equal(records.get(next.jobId).status, 'waiting')
  assert.equal(records.get(next.jobId).expiresAt, next.expiresAt)
  assert.equal(records.get(next.jobId).state.items[0].replyId, 'saved-reply')
  assert.equal(checks, before)
  now = Date.parse(next.expiresAt) + 1
  const rollover = await service.prepareManaged(1, 'auto')
  assert.notEqual(rollover.jobId, next.jobId)
  assert.equal(records.get(rollover.jobId).state.items[0].replyId, 'saved-reply')
  assert.ok(records.get(rollover.jobId).state.verificationSources.includes(next.jobId))
  service.stop()
})

test('an ambiguous withdrawal holds only its own ID while the remaining approved queue advances', async () => {
  const f = withdrawalFixture(); let now = f.runtime.now(); f.runtime.now = () => now
  const cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => {
    if (id === '1') { f.calls.push(id); throw Object.assign(Error('lost'), { details: { httpStatus: 500 } }) }
    await cancel(account, id)
  }
  let service = createInvitationWithdrawal(f.runtime)
  await service.startAutomatic!(1, 'unknown-withdrawal')
  assert.equal((await service.stepManaged!(1, 'unknown-withdrawal')).status, 'verifying')
  service = createInvitationWithdrawal(f.runtime)
  for (let i = 0; i < 5 && f.calls.length < 2; i++) {
    const step = await service.stepManaged!(1, 'unknown-withdrawal')
    if (step.nextActionAt) now = Math.max(now, Date.parse(step.nextActionAt))
  }
  assert.deepEqual(f.calls, ['1', '2'])
  const run = (await service.status(1))!
  assert.deepEqual(run.unconfirmed, ['1']); assert.equal(run.withdrawn, 1)
  assert.equal(run.cursor, 2)
  await service.stepManaged!(1, run.id, true)
  service = createInvitationWithdrawal(f.runtime); await service.resumeManaged!(1, run.id)
  const wait = await service.stepManaged!(1, run.id)
  if (wait.nextActionAt) now = Math.max(now, Date.parse(wait.nextActionAt))
  f.pending([])
  await service.stepManaged!(1, run.id)
  assert.deepEqual(f.calls, ['1', '2'])
  assert.equal((await service.status(1))?.status, 'completed')
  assert.equal((await service.status(1))?.skipped, 1)
})
