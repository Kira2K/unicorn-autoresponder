import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBudgetWatchdog, runGuardedTask } from '../infrastructure/budget-watchdog.ts'
import { createQuotaGuard, evaluateQuota, primaryRateLimit, readGuardState, type BudgetPolicy, type RateLimitObservation } from '../infrastructure/quota-guard.ts'

const now = Date.parse('2026-09-29T16:22:00.000Z')
const policy = (baseline = 4): BudgetPolicy => ({ version: 1, campaignId: 'guarded-test', baseline: {
  observedAt: '2026-09-29T16:21:40.312Z', limitId: 'codex', windowMinutes: 10080, usedPercent: baseline, resetsAt: 1791292390 },
  allowancePoints: 5, bufferPoints: 1, pauseAtPercent: baseline + 4, stopAtPercent: baseline + 5 })
const observation = (usedPercent: number, extra: Partial<RateLimitObservation> = {}): RateLimitObservation => ({
  observedAt: new Date(now).toISOString(), limitId: 'codex', windowMinutes: 10080, usedPercent, resetsAt: 1791292390, ...extra })

test('baseline 3 stops admission at 7 and requests a hard stop at 8', () => {
  const p = policy(3)
  assert.deepEqual(evaluateQuota(p, observation(6.9), undefined, now), { status: 'ready', reason: 'within_budget' })
  assert.equal(evaluateQuota(p, observation(7), undefined, now).status, 'admission_stopped')
  assert.equal(evaluateQuota(p, observation(8), undefined, now).status, 'hard_stopped')
})

test('a coarse jump to 8.4 records the overshoot and stops new work without inferring percentage from tokens', () => {
  const result = evaluateQuota(policy(3), observation(8.4), observation(3), now)
  assert.deepEqual(result, { status: 'hard_stopped', reason: 'quota_hard_stop' })
})

test('missing, malformed, stale, changed-window and rollback observations fail closed', () => {
  const p = policy()
  assert.equal(evaluateQuota(p, undefined, undefined, now).reason, 'rate_limit_missing')
  assert.equal(evaluateQuota(p, observation(Number.NaN), undefined, now).reason, 'rate_limit_invalid')
  assert.equal(evaluateQuota(p, observation(4, { observedAt: new Date(now - 30_001).toISOString() }), undefined, now).reason, 'rate_limit_stale')
  assert.equal(evaluateQuota(p, observation(4, { windowMinutes: 60 }), undefined, now).reason, 'rate_limit_window_changed')
  assert.equal(evaluateQuota(p, observation(4, { resetsAt: p.baseline.resetsAt + 3 }), undefined, now).reason, 'rate_limit_window_changed')
  assert.equal(evaluateQuota(p, observation(3.9), undefined, now).reason, 'rate_limit_decreased')
  assert.equal(evaluateQuota(p, observation(4.9), observation(5), now).reason, 'rate_limit_decreased')
})

test('one-second reset timestamp jitter remains the pinned original window', () => {
  const p = policy(), result = evaluateQuota(p, observation(4, { resetsAt: 1791292389 }), undefined, now)
  assert.deepEqual(result, { status: 'ready', reason: 'within_budget' })
  assert.equal(p.baseline.resetsAt, 1791292390)
})

test('restart preserves baseline, observed high-water mark and response-ID token deduplication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-restart-')), path = join(root, 'state.json'), p = policy()
  try {
    const first = createQuotaGuard(p, { statePath: path, now: () => now })
    await first.observe(observation(6))
    await first.recordCall({ ok: true, responseId: 'response-1', inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 8 })
    await first.recordCall({ ok: false, inputTokens: 999, outputTokens: 999 })
    const restarted = createQuotaGuard(p, { statePath: path, now: () => now, initialState: await readGuardState(path) })
    await restarted.recordCall({ ok: true, responseId: 'response-1', inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 8 })
    assert.equal((await restarted.observe(observation(5.9))).reason, 'rate_limit_decreased')
    assert.equal((await restarted.observe(observation(5.9))).reason, 'rate_limit_decreased')
    assert.equal(restarted.latest().observation?.usedPercent, 6)
    assert.deepEqual(restarted.latest().accounting, { calls: 3, failedCalls: 1, uniqueResponses: 1,
      duplicateResponses: 1, responsesWithoutId: 1, knownInputTokens: 100, knownCachedInputTokens: 40,
      knownUncachedInputTokens: 60, knownOutputTokens: 20, knownReasoningTokens: 8 })
    assert.equal(restarted.policy.baseline.usedPercent, 4)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('genuine hard stop stays latched after restart while transient pauses can recover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-latch-')), path = join(root, 'state.json'), p = policy()
  try {
    const guard = createQuotaGuard(p, { statePath: path, now: () => now })
    await guard.observe(observation(9))
    await guard.setFailure()
    assert.equal(guard.latest().status, 'hard_stopped')
    const restarted = createQuotaGuard(p, { statePath: path, now: () => now, initialState: await readGuardState(path) })
    assert.equal((await restarted.observe(observation(9))).reason, 'quota_hard_stop_latched')
    const transient = createQuotaGuard(p, { statePath: join(root, 'transient.json'), now: () => now })
    await transient.observe(observation(4, { windowMinutes: 60 }))
    assert.equal((await transient.observe(observation(4))).status, 'ready')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('admission becomes stale without another read and failed responses retain their measured usage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-stale-'))
  let clock = now
  try {
    const guard = createQuotaGuard(policy(), { statePath: join(root, 'state.json'), now: () => clock })
    await guard.observe(observation(4))
    await guard.recordCall({ ok: false, responseId: 'failed-response', inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 })
    await guard.recordCall({ ok: false, responseId: 'failed-response', inputTokens: 100, cachedInputTokens: 40, outputTokens: 20 })
    assert.equal(guard.latest().accounting.knownInputTokens, 100)
    assert.equal(guard.latest().accounting.failedCalls, 2)
    clock += 30_001
    assert.equal(guard.admission().reason, 'rate_limit_stale')
    assert.equal(guard.admission().allowed, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('loss of live quota visibility interrupts owned work and leaves a paused report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-missing-'))
  let calls = 0, cancellations = 0
  try {
    const guard = createQuotaGuard(policy(), { statePath: join(root, 'state.json'), now: () => now })
    const watchdog = createBudgetWatchdog({ guard, reportPath: join(root, 'report.json'), now: () => now,
      readRateLimit: async () => ++calls === 1 ? { rateLimitsByLimitId: { codex: { secondary: {
        usedPercent: 4, windowDurationMins: 10080, resetsAt: 1791292390 } } } } : {},
      cancelOwnedWork: async () => { cancellations++ } })
    await watchdog.preflight({ live: true })
    await watchdog.pollOnce()
    assert.equal(watchdog.signal.aborted, true)
    assert.equal(cancellations, 1)
    assert.equal(guard.latest().status, 'paused')
    const before = calls
    await watchdog.pollOnce()
    assert.equal(calls, before, 'an aborted monitor must not silently resume its cancelled worker')
    assert.equal(guard.latest().status, 'paused')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('watchdog rejects live preflight without owned cancellation and fails closed on transport errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-preflight-')), p = policy()
  try {
    const guard = createQuotaGuard(p, { statePath: join(root, 'state.json'), now: () => now })
    const missingCancel = createBudgetWatchdog({ guard, reportPath: join(root, 'report.json'), readRateLimit: async () => ({}) , now: () => now })
    await assert.rejects(missingCancel.preflight({ live: true }), /live_cancellation_required/)
    const failed = createBudgetWatchdog({ guard, reportPath: join(root, 'failed.json'), readRateLimit: async () => { throw Error('auth secret') }, now: () => now })
    await assert.rejects(failed.preflight({ live: false }), /budget_preflight_rate_limit_read_failed/)
    assert.equal(failed.latest().status, 'paused')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('independent watchdog cancels one owned worker on hard stop and writes a non-AI stop report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-watchdog-')), p = policy()
  let usage = 4, releasePoll!: () => void, cancellations = 0, signalPollReady!: () => void
  const pollReady = new Promise<void>(resolve => { signalPollReady = resolve })
  const sleep = () => new Promise<void>(resolve => { releasePoll = resolve; signalPollReady() })
  try {
    const guard = createQuotaGuard(p, { statePath: join(root, 'state.json'), now: () => now })
    const watchdog = createBudgetWatchdog({ guard, reportPath: join(root, 'report.json'), pollIntervalMs: 5_000, sleep,
      now: () => now, readRateLimit: async () => ({ rateLimitsByLimitId: { codex: { primary: {
        usedPercent: usage, windowDurationMins: 10080, resetsAt: 1791292390 } } } }),
      cancelOwnedWork: async () => { cancellations++ } })
    const task = runGuardedTask(watchdog, { live: true }, async ({ signal }) => new Promise<'stopped'>(resolve => {
      signal.addEventListener('abort', () => resolve('stopped'), { once: true })
    }))
    await pollReady
    usage = 9; releasePoll()
    assert.equal(await task, 'stopped')
    assert.equal(cancellations, 1)
    const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'))
    assert.equal(report.status, 'hard_stopped')
    assert.equal(report.cancellation, 'succeeded')
    assert.equal(JSON.stringify(report).includes('prompt'), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('background report failure aborts and cancels the worker without an unhandled monitor rejection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-monitor-failure-')), p = policy()
  let releasePoll!: () => void, signalPollReady!: () => void, writes = 0, cancellations = 0
  const pollReady = new Promise<void>(resolve => { signalPollReady = resolve })
  try {
    const guard = createQuotaGuard(p, { statePath: join(root, 'state.json'), now: () => now })
    const watchdog = createBudgetWatchdog({ guard, reportPath: join(root, 'report.json'), now: () => now,
      readRateLimit: async () => ({ rateLimitsByLimitId: { codex: { primary: {
        usedPercent: 4, windowDurationMins: 10080, resetsAt: 1791292390 } } } }),
      sleep: () => new Promise<void>(resolve => { releasePoll = resolve; signalPollReady() }),
      writeReport: async () => { if (++writes > 1) throw Error('disk unavailable') },
      cancelOwnedWork: async () => { cancellations++ } })
    const task = runGuardedTask(watchdog, { live: true }, async ({ signal }) => new Promise(resolve => {
      signal.addEventListener('abort', resolve, { once: true })
    }))
    await pollReady; releasePoll()
    await assert.rejects(task, /disk unavailable/)
    assert.equal(cancellations, 1)
    assert.equal(guard.latest().status, 'paused')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('primary rate-limit parser ignores account metadata', () => {
  assert.deepEqual(primaryRateLimit({ accountId: 'must-not-escape', rateLimitsByLimitId: { codex: { primary: {
    usedPercent: 4, windowDurationMins: 10080, resetsAt: 1791292390 } } } }, '2026-09-29T16:30:24.000Z'), {
    observedAt: '2026-09-29T16:30:24.000Z', limitId: 'codex', windowMinutes: 10080, usedPercent: 4, resetsAt: 1791292390 })
})

test('weekly bucket selection does not assume the provider primary label', () => {
  const parsed = primaryRateLimit({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1 },
    secondary: { usedPercent: 4, windowDurationMins: 10080, resetsAt: 1791292390 },
  } } }, '2026-09-29T16:30:24.000Z', 10080)
  assert.equal(parsed?.usedPercent, 4)
  assert.equal(parsed?.resetsAt, 1791292390)
})

test('a jump beyond the five-point ceiling writes the measured overshoot to its stop report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quota-overshoot-'))
  try {
    const guard = createQuotaGuard(policy(3), { statePath: join(root, 'state.json'), now: () => now })
    const watchdog = createBudgetWatchdog({ guard, reportPath: join(root, 'report.json'), now: () => now,
      readRateLimit: async () => ({ rateLimitsByLimitId: { codex: { secondary: {
        usedPercent: 8.4, windowDurationMins: 10080, resetsAt: 1791292390 } } } }), cancelOwnedWork: async () => {} })
    await assert.rejects(watchdog.preflight({ live: true }), /quota_hard_stop/)
    const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'))
    assert.equal(report.status, 'hard_stopped')
    assert.ok(Math.abs(report.overshootPoints - 0.4) < 0.00001)
    assert.ok(Math.abs(report.percentagePointsSinceBaseline - 5.4) < 0.00001)
  } finally { await rm(root, { recursive: true, force: true }) }
})
