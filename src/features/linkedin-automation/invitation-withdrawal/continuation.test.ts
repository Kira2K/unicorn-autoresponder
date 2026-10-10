import { test } from 'node:test'
import assert from 'node:assert/strict'

test('new day archives a stopped withdrawal and never cancels its unknown ID again', async () => {
  const f = fixture(); let now = f.runtime.now()
  f.runtime.now = () => now
  await f.service.startAutomatic!(1, 'day-one')
  await f.service.stepManaged!(1, 'day-one')
  await f.service.stepManaged!(1, 'day-one', true)
  const previous = f.stored()!.run!
  assert.deepEqual(previous.confirmed, ['1']); assert.equal(previous.checkedAt, undefined)
  // Even if the provider still shows the old ID, it is not a new cancellation.
  f.pending([1, 2].map(id => ({ id: String(id), name: 'Mock', createdAt: '2026-08-01T00:00:00Z' })))
  await f.service.close(); now += 86400_000
  const next = createInvitationWithdrawal(f.runtime)
  try {
    const run = await next.startAutomatic!(1, 'day-two')
    assert.deepEqual(run.targets!.map(item => item.id), ['2'])
    assert.deepEqual(f.stored()!.previousRuns, [previous])
    await next.stepManaged!(1, 'day-two')
    assert.deepEqual(f.calls, ['1', '2'])
    assert.deepEqual(f.stored()!.previousRuns, [previous])
    assert.equal((await next.startAutomatic!(1, 'day-one')).status, 'stopped')
    assert.equal(f.stored()!.run!.id, 'day-two')
  } finally { await next.close() }
})

test('new withdrawal preserves provider wait and cannot proceed if archiving fails', async () => {
  const f = fixture()
  await f.service.startAutomatic!(1, 'old'); await f.service.stepManaged!(1, 'old')
  await f.service.stepManaged!(1, 'old', true)
  const stopped = f.stored()!, until = f.runtime.now() + 3600_000
  await f.runtime.store.save(1, { ...stopped, retryAt: until })
  await assert.rejects(f.service.startAutomatic!(1, 'new'), { code: 'withdrawal_cooldown' })
  await f.runtime.store.save(1, stopped)
  const save = f.runtime.store.save
  f.runtime.store.save = async (_id, state) => { if (state.run?.id === 'new') throw Error('archive failed'); await save(_id, state) }
  await assert.rejects(f.service.startAutomatic!(1, 'new'), /archive failed/)
  assert.equal(f.stored()!.run!.id, 'old'); assert.deepEqual(f.calls, ['1'])
  await f.service.close()
})
import { fixture, finished } from './test-fixture.ts'
import { createInvitationWithdrawal } from './service.ts'
import { withdrawalSteps } from './execution.ts'
import { listReadError } from '../../../integrations/unipile/read-retry.ts'

test('500 on one cancel expires after 20 minutes; restart continues next target without repeating POST', async () => {
  const f = fixture(); let now = f.runtime.now(), listReads = 0
  f.runtime.now = () => now
  const run = await f.service.startAutomatic!(1, 'budget')
  const cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => {
    if (id !== '1') return cancel(account, id)
    f.calls.push(id); throw Object.assign(Error('server'), { code: 'unipile_http_500',
      details: { httpStatus: 500, retryAfterMs: 300_000 } })
  }
  f.provider.list = async () => { listReads++; throw Object.assign(Error('server'), {
    code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } }) }
  await f.service.stepManaged!(1, run.id)
  const first = f.stored()!.run!.recovery!['cancel:1'].firstFailedAt
  const restarted = createInvitationWithdrawal(f.runtime)
  now = first + 5 * 60_000; await restarted.stepManaged!(1, run.id)
  assert.deepEqual(f.calls, ['1'])
  now = first + 20 * 60_000
  f.provider.list = async () => { listReads++; return [{ id: '1', name: 'one', createdAt: '2026-08-01T00:00:00Z' }] }
  await restarted.stepManaged!(1, run.id)
  assert.deepEqual(f.calls, ['1', '2'])
  const result = await restarted.stepManaged!(1, run.id)
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.summary, { completed: 1, skipped: 0, unconfirmed: 1 })
  assert.deepEqual(f.stored()!.run!.unconfirmed, ['1'])
  assert.ok(f.stored()!.run!.recoveryClosed)
})

test('failed expiry checkpoint prevents the next cancel until the skipped intent is durable', async () => {
  const f = fixture(); let now = f.runtime.now()
  f.runtime.now = () => now
  const run = await f.service.startAutomatic!(1, 'expiry-save')
  const state = f.stored()!
  state.attempted = ['1']; state.run!.current = '1'; state.run!.status = 'uncertain'
  state.run!.recovery = { 'cancel:1': { firstFailedAt: now - 20 * 60_000, httpStatus: 500 } }
  await f.runtime.store.save(1, state)
  const save = f.runtime.store.save; let failing = true
  f.runtime.store.save = async (id, value) => { if (failing) throw Error('storage failed'); await save(id, value) }
  const service = createInvitationWithdrawal(f.runtime)
  await assert.rejects(service.stepManaged!(1, run.id)); assert.deepEqual(f.calls, [])
  failing = false; await service.stepManaged!(1, run.id)
  assert.deepEqual(f.calls, ['2']); assert.deepEqual(f.stored()!.run!.unconfirmed, ['1'])
})

test('batch verification 500 finishes with an honest unconfirmed count after its 20 minute budget', async () => {
  const f = fixture(); let now = f.runtime.now()
  f.runtime.now = () => now
  const run = await f.service.startAutomatic!(1, 'batch-budget')
  await f.service.stepManaged!(1, run.id); now += 10_000; await f.service.stepManaged!(1, run.id)
  f.provider.list = async () => { throw Object.assign(Error('server'), {
    code: 'unipile_http_500', details: { httpStatus: 500, retryAfterMs: 300_000 } }) }
  await f.service.stepManaged!(1, run.id)
  const first = f.stored()!.run!.recovery!.readback.firstFailedAt
  now = first + 20 * 60_000
  const result = await createInvitationWithdrawal(f.runtime).stepManaged!(1, run.id)
  assert.equal(result.status, 'completed'); assert.deepEqual(result.summary, { completed: 0, skipped: 0, unconfirmed: 2 })
  assert.deepEqual(f.calls, ['1', '2']); assert.equal(f.stored()!.run!.checkedAt, undefined)
})

for (const failure of [Object.assign(new Error('provider'), { code: 'unipile_http_500', details: { httpStatus: 500 } }),
  listReadError('withdrawal_list_invalid', 'incomplete', { page: 2 })]) {
  test(`${failure.code}: saved read pause survives restart without repeating withdrawals`, async () => {
    const f = fixture(); let now = f.runtime.now(), verifies = 0
    const freshFailure = () => Object.assign(new Error(failure.message),
      { code: failure.code, details: structuredClone(failure.details) })
    f.runtime.now = () => now
    const run = await f.service.startAutomatic!(1, 'automatic')
    f.provider.verify = async () => { if (++verifies === 1) throw freshFailure() }
    const waiting = await f.service.stepManaged!(1, run.id)
    assert.equal(waiting.status, 'waiting'); assert.deepEqual(f.calls, [])
    assert.equal(f.stored()?.retryAt, now + 60_000)
    const restarted = createInvitationWithdrawal(f.runtime)
    await restarted.stepManaged!(1, run.id); assert.equal(verifies, 1)
    now += 60_000
    await restarted.stepManaged!(1, run.id)
    assert.deepEqual(f.calls, ['1'])
    now += 10_000; await restarted.stepManaged!(1, run.id)
    let readbacks = 0
    f.provider.list = async () => { if (++readbacks === 1) throw freshFailure(); return [] }
    const pending = await restarted.stepManaged!(1, run.id)
    assert.equal(pending.status, 'verifying'); assert.deepEqual(f.calls, ['1', '2'])
    assert.equal(f.stored()?.retryAt, now + 60_000, JSON.stringify({ pending, state: f.stored(), now }))
    const recovered = createInvitationWithdrawal(f.runtime)
    await recovered.stepManaged!(1, run.id); assert.equal(readbacks, 1)
    now = f.stored()!.retryAt!
    assert.equal((await recovered.stepManaged!(1, run.id)).status, 'completed')
    assert.deepEqual(f.calls, ['1', '2']); assert.equal(f.stored()?.run?.withdrawn, 2)
  })
}

test('unknown invitations protect overlapping targets, not unrelated old withdrawals', async () => {
  const f = fixture()
  f.pending([{ id: 'old', name: 'old', createdAt: '2026-07-01T00:00:00Z' },
    { id: 'overlap', name: 'overlap', createdAt: '2026-08-01T00:00:00Z' }])
  f.runtime.protectedSince = async () => Date.parse('2026-07-20T00:00:00Z')
  const s = createInvitationWithdrawal(f.runtime), preview = await s.preview(1)
  assert.deepEqual(preview.items.filter(i => i.eligible).map(i => i.id), ['old'])
  await s.start(1, preview.token); await finished(s)
  assert.deepEqual(f.calls, ['old'])
})

test('new uncertainty after preview is checked before every cancellation', async () => {
  const f = fixture(), s = createInvitationWithdrawal(f.runtime)
  const run = await s.startAutomatic!(1, 'automatic')
  f.runtime.protectedSince = async () => -Infinity
  const fresh = createInvitationWithdrawal(f.runtime)
  for (let i = 0; i < 5; i++) {
    const result = await fresh.stepManaged!(1, run.id)
    if (result.status === 'completed') break
  }
  assert.deepEqual(f.calls, []); assert.equal(f.stored()?.run?.skipped, 2)
})

test('automatic pacing is not reported as a backend restart', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'automatic')
  await f.service.stepManaged!(1, run.id)
  const status = await f.service.status(1)
  assert.equal(status?.status, 'running'); assert.equal(status?.error, undefined)
})

test('Stop after restart preserves unverified cancellation and forbids provider read-back', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'automatic')
  await f.service.stepManaged!(1, run.id)
  let reads = 0
  f.provider.list = async () => { reads++; return [] }
  f.provider.verify = async () => { reads++ }
  const restarted = createInvitationWithdrawal(f.runtime)
  await restarted.stop(1)
  const stopped = await restarted.stepManaged!(1, run.id)
  assert.equal(stopped.status, 'stopped')
  assert.equal(reads, 0); assert.equal(f.stored()?.run?.stopRequested, true)
  assert.deepEqual(f.stored()?.run?.confirmed, ['1']); assert.equal(f.stored()?.run?.checkedAt, undefined)
  assert.deepEqual(f.calls, ['1'])
  const later = f.runtime.now() + 86400_000; f.runtime.now = () => later
  assert.equal((await restarted.stepManaged!(1, run.id)).status, 'stopped')
  assert.equal(reads, 0); assert.deepEqual(f.calls, ['1'], 'remaining approved targets must not be withdrawn after Stop')
})

test('SQL object key order does not change the approved account during continuation', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'linkedin:owner:2026-09-16:withdrawals:slot')
  const state = f.stored()!
  state.run!.approvedAccount = Object.fromEntries(Object.entries(state.run!.approvedAccount!).reverse()) as any
  state.run!.status = 'failed'
  await f.runtime.store.save(1, state)
  const service = createInvitationWithdrawal(f.runtime)
  await service.resume(1, run.id)
  const result = await finished(service)
  assert.equal(result?.status, 'completed'); assert.equal(result?.id, run.id)
  assert.deepEqual(f.calls, ['1', '2']); assert.equal(result?.withdrawn, 2)
})

test('continuation still blocks a changed account, student binding, URL or owner ID', async () => {
  for (const changed of [{ platformAccountId: 2 }, { accountId: 'other' },
    { linkedinUrl: 'https://www.linkedin.com/in/other' }, { verifiedProviderId: 'other-owner' }]) {
    const f = fixture(), run = await f.service.startAutomatic!(1, 'automatic')
    const account = await f.runtime.account(1)
    f.runtime.account = async () => ({ ...account, ...changed })
    const step = await f.service.stepManaged!(1, run.id)
    assert.equal(step.status, 'needs_attention'); assert.equal(step.reason, 'withdrawal_account_changed')
    assert.deepEqual(f.calls, [])
  }
})

test('resumed approved queue respects shared cooldown before any cancellation', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'automatic')
  const state = f.stored()!
  state.run!.status = 'failed'; await f.runtime.store.save(1, state)
  let now = f.runtime.now(), verifies = 0
  const deadline = now + 5000
  f.runtime.now = () => now
  f.runtime.sleep = async ms => {
    if (now < deadline) {
      assert.deepEqual(f.calls, [])
      assert.equal(f.stored()?.retryAt, deadline)
      assert.equal(f.stored()?.run?.nextActionAt, new Date(deadline).toISOString())
    }
    now += ms
  }
  f.provider.verify = async () => {
    verifies++
    if (now < deadline) throw Object.assign(new Error('saved provider pause'), {
      code: 'unipile_shared_cooldown', notSent: true,
      details: { httpStatus: 429, retryAt: deadline, observedAt: now, retryAfterMs: deadline - now } })
  }
  const service = createInvitationWithdrawal(f.runtime)
  await service.resume(1, run.id)
  assert.equal((await finished(service))?.status, 'completed')
  assert.equal(verifies, 2); assert.deepEqual(f.calls, ['1', '2'])
})

test('saved approved queue resumes the same run, counters and recipients without a new preview', async () => {
  const f = fixture(), preview = await f.service.preview(1)
  const account = await f.runtime.account(1)
  const state = { accountId: account.accountId, attempted: [] as string[], run: {
    id: preview.token, platformAccountId: 1, accountId: account.accountId, status: 'running' as const,
    total: 2, withdrawn: 0, skipped: 0, targets: preview.items, cursor: 0, approvedAccount: account } }
  await f.runtime.store.save(1, state)
  const steps = withdrawalSteps(f.runtime, { ...preview, account, expiresAt: Infinity }, state)
  assert.equal((await steps.next()).value?.status, 'ready')
  assert.deepEqual(f.calls, ['1']); assert.equal(f.stored()?.run?.cursor, 1)
  await steps.return(undefined)
  let time = f.runtime.now(); f.runtime.now = () => time
  f.runtime.sleep = async ms => { time += ms }
  // A newly visible old invitation was never approved in this run.
  f.pending([{ id: '2', name: 'second', createdAt: '2026-08-01T00:00:00Z' },
    { id: 'unapproved', name: 'other', createdAt: '2026-08-01T00:00:00Z' }])
  const next = createInvitationWithdrawal(f.runtime)
  await next.resume(1, preview.token); const run = await finished(next)
  assert.equal(run?.id, preview.token); assert.equal(run?.withdrawn, 2)
  assert.equal(run?.cursor, 2); assert.deepEqual(f.calls, ['1', '2'])
  assert.deepEqual(run?.confirmed, ['1', '2'])
})

test('a legacy interrupted journal checks attempts but cannot invent the remaining targets', async () => {
  const f = fixture()
  await f.runtime.store.save(1, { accountId: 'acc_test', attempted: ['old'], run: {
    id: 'old-run', platformAccountId: 1, accountId: 'acc_test', status: 'running', total: 3,
    withdrawn: 0, skipped: 0, current: 'old' } })
  const run = await f.service.resume(1, 'old-run')
  assert.equal(run?.status, 'interrupted'); assert.equal(run?.skipped, 1)
  assert.deepEqual(f.calls, [])
})

test('a stopped run cannot resume writes, including after reopening the service', async () => {
  const f = fixture(), cancel = f.provider.cancel
  f.provider.cancel = async (account, id) => { await cancel(account, id); await f.service.stop(1) }
  const { token } = await f.service.preview(1)
  await f.service.start(1, token); await finished(f.service)
  assert.equal(f.stored()?.run?.stopRequested, true)
  const service = createInvitationWithdrawal(f.runtime)
  await service.resume(1, token); await finished(service)
  assert.deepEqual(f.calls, ['1'])
})

test('Stop while another feature owns the account ends the wait without another POST', async () => {
  const f = fixture(), acquire = f.runtime.gate.acquire
  let acquisitions = 0
  f.runtime.gate.acquire = (...args) => {
    if (++acquisitions > 1) throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active' })
    return acquire(...args)
  }
  f.runtime.sleep = async ms => { assert.ok(ms <= 250); await f.service.stop(1) }
  const { token } = await f.service.preview(1)
  await f.service.start(1, token)
  assert.equal((await finished(f.service))?.status, 'stopped')
  assert.equal(f.stored()?.run?.stopRequested, true)
  assert.deepEqual(f.calls, [])
})

test('a failed driver checkpoint ends the background task and forbids sending', async () => {
  const f = fixture(), acquire = f.runtime.gate.acquire
  let acquisitions = 0
  f.runtime.gate.acquire = (...args) => {
    if (++acquisitions > 1) throw Object.assign(new Error('busy'), { code: 'linkedin_operation_active' })
    return acquire(...args)
  }
  f.failSave(2)
  const { token } = await f.service.preview(1)
  await f.service.start(1, token)
  assert.equal((await finished(f.service))?.status, 'failed')
  assert.deepEqual(f.calls, [])
})

test('managed waiting and Stop before any attempt do not need the account gate', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'auto-stop')
  const state = f.stored()!
  state.run!.nextActionAt = new Date(f.runtime.now() + 3600_000).toISOString()
  await f.runtime.store.save(1, state)
  f.runtime.gate.acquire = () => { throw new Error('account belongs to another feature') }
  assert.equal((await f.service.stepManaged!(1, run.id)).status, 'waiting')
  assert.equal((await f.service.stepManaged!(1, run.id, true)).status, 'stopped')
  assert.equal(f.stored()?.run?.stopRequested, true)
  assert.deepEqual(f.calls, [])
})

test('managed Stop retains an unknown attempt and its provider deadline without holding the gate', async () => {
  const f = fixture(), run = await f.service.startAutomatic!(1, 'auto-unknown')
  const state = f.stored()!, deadline = f.runtime.now() + 3600_000
  state.run!.current = state.run!.targets![0].id
  state.run!.status = 'uncertain'; state.run!.nextActionAt = new Date(deadline).toISOString()
  await f.runtime.store.save(1, state)
  f.runtime.gate.acquire = () => { throw new Error('must wait without gate') }
  const result = await f.service.stepManaged!(1, run.id, true)
  assert.equal(result.status, 'stopped'); assert.equal(Date.parse(f.stored()!.run!.nextActionAt!), deadline)
  assert.equal(f.stored()?.run?.current, state.run!.current); assert.deepEqual(f.calls, [])
})
