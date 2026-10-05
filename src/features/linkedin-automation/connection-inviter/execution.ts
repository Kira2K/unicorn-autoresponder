import { verifyConnectionAccount } from './account.mts'
import { nextConnectionAudience } from './audience-sequence.ts'
import { createCandidateDiscovery } from './discovery.ts'
import { confirmedQuotaExceeded, confirmedQuotaReached,
  synchronizeConfirmedProgress, invitationCapacity } from './daily-progress.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { dailyAudienceTargets, dailyInvitationLimit } from './limits.ts'
import { reconcileInvitations } from './pending.ts'
import { createInvitationPublisher } from './publisher.ts'
import { finishRunStop } from './run-control.ts'
import { waitOrStop } from './run-control.ts'
import { withConnectionRetry } from './retry-state.ts'
import { beginInvitationVerification, deferInvitationVerification, clearVerificationWait, expireInvitationRecovery } from './invitation-verification.ts'
import { ACTION_SKIPPED, skippedActions, recoveryDeadline } from '../action-recovery.ts'
import { safeErrorDetails, withConnectionRequestTrace } from './logger.ts'
import { CONNECTION_NOCO_OPTIONAL_RESERVE } from './noco-budget.ts'
import { closeConnectionRunDay, connectionRunDayIsOpen,
  requireConnectionRunDay } from './day-window.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { sendDelay } from './run-model.ts'

const quotaEmpty = (quota: { recruiter: number; technical: number }) =>
  quota.recruiter <= 0 && quota.technical <= 0

const progressFromCounters = (run: ConnectionRun) => ({
  sent: { ...run.counters.sentByAudience },
  sentTotal: run.counters.sent,
  remaining: {
    recruiter: Math.max(0, run.audienceQuota.recruiter - run.counters.sentByAudience.recruiter),
    technical: Math.max(0, run.audienceQuota.technical - run.counters.sentByAudience.technical)
  }
})

async function acquireAccountGate(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  allowAfterDayClose = false, ignoreStopRequested = false) {
  while (true) {
    if (runtime.cooperative) runtime.assertWriterOwnership?.()
    try {
      return runtime.gate?.acquire('connection_inviter', run.runId,
        String(run.platformAccountId))
    } catch (error) {
      if (connectionErrorCode(error) !== 'linkedin_operation_active') throw error
      const delayMs = 30_000 + Math.floor(Math.min(1, Math.max(0, runtime.random())) * 60_000)
      const nextActionAt = new Date(runtime.now().getTime() + delayMs).toISOString()
      run.stage = 'waiting_gate'; run.nextActionAt = nextActionAt
      run.timerState = { kind: 'operation_gate_wait', delayMs, nextActionAt }
      await save(run, 'timer_started')
      if (runtime.cooperative) {
        await save(run, 'timer_started', 'critical')
        if (!runtime.cooperate) throw connectionError('connection_step_yield', 'Account is occupied.')
        // Keep the same execution and its verified snapshot while yielding the
        // account. Draining the iterator here would restart all history reads.
        const proceed = await runtime.cooperate(async () => {
          if (ignoreStopRequested) { await runtime.sleep(delayMs); return true }
          return waitOrStop(runtime, run.runId, delayMs,
            allowAfterDayClose ? undefined : run.localDate)
        }, Date.parse(nextActionAt))
        if (!proceed) return undefined
      } else {
        if (ignoreStopRequested) await runtime.sleep(delayMs)
        else if (!await waitOrStop(runtime, run.runId, delayMs,
          allowAfterDayClose ? undefined : run.localDate)) return undefined
      }
      run.timerState = undefined; run.nextActionAt = undefined
    }
  }
}

export async function* connectionSteps(...args: Parameters<typeof runConnectionSteps>): AsyncGenerator<ExecutionStep> {
  const [runtime, run, running] = args
  if (running.has(run.runId) || !runtime.writerEnabled) {
    yield { status: 'needs_attention', reason: running.has(run.runId) ? 'connection_executor_active' : 'connection_writer_disabled' }
    return
  }
  for await (const step of runConnectionSteps(...args)) yield { ...step, skippedActions: skippedActions(run.searchProgress.actionRecovery),
    recoveryDeadlineAt: recoveryDeadline(run.searchProgress.actionRecovery) }
  // Early Stop, unresolved outcomes and failures are results too. Never report
  // a drained iterator as a completed business run just because it returned.
  const status = run.status === 'succeeded' ? 'completed' : run.status === 'stopped' ? 'stopped' :
    run.errorCode === 'connection_invitation_result_pending' ? 'verifying' :
    run.status === 'running' && run.nextActionAt ? 'waiting' : 'needs_attention'
  yield { status, reason: run.errorCode, nextActionAt: run.nextActionAt,
    skippedActions: skippedActions(run.searchProgress.actionRecovery),
    recoveryDeadlineAt: run.status === 'running' ? recoveryDeadline(run.searchProgress.actionRecovery) : undefined,
    ...(['succeeded', 'partial', 'failed'].includes(run.status) ? { summary: { completed: run.counters.sent,
      skipped: run.counters.skipped, unconfirmed: Object.keys(run.searchProgress.reservedInvitations ?? {}).length } } : {}) }
}

async function* runConnectionSteps(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun, initialOpenHistory?: ConnectionHistoryItem[],
  yieldBetweenSteps = true): AsyncGenerator<ExecutionStep> {
  if (running.has(run.runId) || run.status !== 'running' || !runtime.writerEnabled) return
  running.add(run.runId); let release: (() => void) | undefined
  if (runtime.cooperate) {
    const original = runtime
    runtime = { ...runtime, async yieldWait(until) {
      if (until <= runtime.now().getTime()) return !runtime.stopRequested(run.runId)
      await save(run, 'timer_started', 'critical')
      const unknown = (await runtime.store.listOpenHistory(run.platformAccountId, 1000))
        .some(item => ['sending', 'uncertain'].includes(item.status))
      release?.(); release = undefined
      const result = await original.cooperate!(() => waitOrStop(runtime, run.runId,
        Math.max(0, until - runtime.now().getTime()), run.localDate), until, unknown)
      runtime.assertWriterOwnership?.()
      release = await acquireAccountGate(runtime, run, save)
      return result
    } }
  }
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  const nocoStart = runtime.store.requestStats?.()
  const checkpoint = async function* (reason: string): AsyncGenerator<ExecutionStep> {
    // A continuous manual run does not hand control to another feature. Keep its
    // existing storage budget; durable extra snapshots are needed only before an actual yield.
    if (!yieldBetweenSteps) { await save(run, 'progress'); return }
    if (reason === 'candidate_result_saved' && !confirmedQuotaReached(progressFromCounters(run), run.audienceQuota) &&
      run.searchProgress.invitationPacingStarted && !Number.isFinite(Date.parse(run.searchProgress.invitationNotBefore ?? ''))) {
      run.searchProgress.invitationNotBefore = new Date(runtime.now().getTime() + sendDelay(runtime.random)).toISOString()
      run.nextActionAt = new Date(Math.max(Date.parse(run.searchProgress.invitationNotBefore),
        Date.parse(run.searchProgress.invitationVerification?.blockedUntil ?? '') || 0)).toISOString()
    }
    await save(run, 'progress', 'critical')
    release?.(); release = undefined
    yield { status: Date.parse(run.nextActionAt ?? '') > runtime.now().getTime() ? 'waiting' : 'ready',
      reason, nextActionAt: run.nextActionAt }
    runtime.assertWriterOwnership?.()
    while (!runtime.stopRequested(run.runId)) {
      try { release = await acquireAccountGate(runtime, run, save); break }
      catch (error) {
        if (connectionErrorCode(error) !== 'connection_step_yield') throw error
        yield { status: 'waiting', reason: 'linkedin_operation_active', nextActionAt: run.nextActionAt }
        runtime.assertWriterOwnership?.()
      }
    }
  }
  const holdUnsafeTerminal = async (stage: 'resolving_uncertain' | 'stop_requested',
    knownHistory?: ConnectionHistoryItem[], retryError?: unknown) => {
    const open = knownHistory ?? await withConnectionRetry(runtime, run, save, 'storage',
      'terminal_open_history_readback', () => runtime.store.listOpenHistory(
        run.platformAccountId, 1000), { allowAfterDayClose: true, ignoreStopRequested: true })
    await expireInvitationRecovery(runtime, run, save, open)
    const unsafe = open.filter(item => item.runId === run.runId && item.reasonCode !== ACTION_SKIPPED &&
      ['sending', 'uncertain'].includes(item.status))
    if (!unsafe.length) return false
    if (!run.searchProgress.invitationVerification) await beginInvitationVerification(runtime, run, save, unsafe)
    await deferInvitationVerification(runtime, run, save, retryError)
    return true
  }
  const finishStopSafely = async () => {
    if (!runtime.stopRequested(run.runId)) return false
    const stoppedHistory = await withConnectionRetry(runtime, run, save, 'storage',
      'stop_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
      { allowAfterDayClose: true, ignoreStopRequested: true })
    synchronizeConfirmedProgress(run, stoppedHistory, run.audienceQuota)
    return finishRunStop(runtime, run, save)
  }
  runtime.logger.event('run', 'started', details)
  try {
    if (await finishStopSafely()) return
    if (Date.parse(run.searchProgress.invitationVerification?.blockedUntil ?? '') > runtime.now().getTime()) {
      await deferInvitationVerification(runtime, run, save); return
    }
    const recoveringClosedDay = !connectionRunDayIsOpen(runtime, run)
    runtime.logger.event('operation_gate_acquire', 'started', details)
    release = await acquireAccountGate(runtime, run, save, recoveringClosedDay)
    if (await finishStopSafely()) return
    runtime.logger.event('operation_gate_acquire', 'succeeded', details)
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    run.stage = run.stage === 'recovering' ? 'recovering' : 'verifying_account'
    await save(run, 'stage_changed')
    const recoveredWait = run.errorCode === 'connection_invitation_result_pending' ? 0 :
      Date.parse(run.nextActionAt ?? '') - runtime.now().getTime()
    if (!recoveringClosedDay && Number.isFinite(recoveredWait) && recoveredWait > 0) {
      const preserveInvitationWriteAttempt = run.retryState?.provider === 'unipile' &&
        run.retryState.operation === 'invitation_write'
      if (!await waitOrStop(runtime, run.runId, recoveredWait, run.localDate)) {
        await finishStopSafely(); return
      }
      if (preserveInvitationWriteAttempt) run.invitationRetryState = run.retryState
      run.retryState = undefined
      run.timerState = undefined; run.nextActionAt = undefined; run.pausedAt = undefined
      run.errorCode = undefined
      await save(run, 'retry_succeeded')
    }
    const reconciliation = await reconcileInvitations(runtime, run, save, { openHistory: initialOpenHistory })
    if (await finishStopSafely()) return
    if (reconciliation.retryError) return
    if (reconciliation.unresolved) clearVerificationWait(run)
    requireConnectionRunDay(runtime, run)
    const frozenQuota = run.dailyQuota !== undefined &&
      run.audienceQuota.recruiter + run.audienceQuota.technical > 0
    const history = await withConnectionRetry(runtime, run, save, 'storage', 'run_history_list', () =>
      runtime.store.listRunHistory(run.runId, 1000))
    // History is durable per candidate; run checkpoints are intentionally coarser.
    // If an attempt finished after the saved timer, recover with a full new pause.
    const latestAttempt = [...history].sort((a, b) =>
      Date.parse(b.verifiedAt ?? b.updatedAt) - Date.parse(a.verifiedAt ?? a.updatedAt))[0]
    if (latestAttempt && run.searchProgress.invitationPauseAfterPersonId !== latestAttempt.personId) {
      run.searchProgress.invitationPacingStarted = true
      run.searchProgress.invitationPauseAfterPersonId = latestAttempt.personId
      run.searchProgress.invitationNotBefore = undefined
    }
    let progress = synchronizeConfirmedProgress(run, history, run.audienceQuota)
    let observedConnectionCount = run.connectionCount
    if (!frozenQuota || !confirmedQuotaReached(progress, run.audienceQuota)) {
      run.stage = 'verifying_account'; await save(run, 'stage_changed')
      observedConnectionCount = await verifyConnectionAccount(runtime, run, save)
      runtime.logger.event('account_verification', 'succeeded', { ...details,
        connectionCount: observedConnectionCount })
    }
    if (!frozenQuota) {
      run.connectionCount = observedConnectionCount
      // Unfrozen quotas always pass account verification above.
      run.dailyLimit = dailyInvitationLimit(observedConnectionCount!)
      const planned = dailyAudienceTargets(run.dailyLimit)
      // Safe recruiter-only mode changes which audience can execute, not the frozen
      // business target. Keeping the full split makes the run partial until a stack
      // is selected, after which a same-day top-up can fill only the technical remainder.
      run.audienceQuota = planned
      run.dailyQuota = run.dailyLimit
    }
    progress = synchronizeConfirmedProgress(run, history, run.audienceQuota)
    if (confirmedQuotaExceeded(progress, run.audienceQuota)) {
      throw connectionError('connection_daily_quota_exceeded',
        'Confirmed invitation history exceeds the daily audience quota.')
    }
    runtime.logger.event('quota_plan', 'succeeded', { ...details,
      connectionCount: run.connectionCount, dailyLimit: run.dailyLimit,
      observedConnectionCount,
      dailyQuota: run.dailyQuota, recruiterQuota: run.audienceQuota.recruiter,
      technicalQuota: run.audienceQuota.technical, sentToday: progress.sentTotal,
      recruiterRemaining: progress.remaining.recruiter,
      technicalRemaining: progress.remaining.technical, safeRecruiterOnly: run.safeRecruiterOnly })
    if (await finishStopSafely()) return

    const queuedIds = new Set(run.searchProgress.pendingCandidates.map(item => item.personId))
    for (const item of history.filter(candidate => candidate.status === 'deferred')) {
      if (!queuedIds.has(item.personId)) {
        run.searchProgress.pendingCandidates.push(item); queuedIds.add(item.personId)
      }
    }
    let publisher: Awaited<ReturnType<typeof createInvitationPublisher>> | undefined
    let discovery: Awaited<ReturnType<typeof createCandidateDiscovery>> | undefined
    let nocoBudgetExhausted = false
    yield* checkpoint('history_and_quota_saved')

    while (!quotaEmpty(invitationCapacity(run).remaining)) {
      requireConnectionRunDay(runtime, run)
      if (Date.parse(run.searchProgress.invitationVerification?.blockedUntil ?? '') > runtime.now().getTime()) {
        await deferInvitationVerification(runtime, run, save); return
      }
      if (run.searchProgress.invitationVerification &&
        Date.parse(run.searchProgress.invitationVerification.nextCheckAt) <= runtime.now().getTime()) {
        const check = await reconcileInvitations(runtime, run, save, { runOnly: true, singlePass: true })
        if (check.retryError) return
        synchronizeConfirmedProgress(run, await runtime.store.listRunHistory(run.runId, 1000))
        clearVerificationWait(run)
        if (quotaEmpty(invitationCapacity(run).remaining)) break
      }
      const used = invitationCapacity(run).used
      const searchableQuota = {
        recruiter: run.searchProgress.exhausted.recruiter
          ? used.recruiter : run.audienceQuota.recruiter,
        technical: run.searchProgress.exhausted.technical
          ? used.technical : run.audienceQuota.technical
      }
      const audience = nextConnectionAudience(used, searchableQuota)
      if (!audience) break
      run.searchProgress.nextAudience = audience
      let candidates = run.searchProgress.pendingCandidates
        .filter(item => item.audience === audience)
      if (!candidates.length) {
        run.stage = 'searching'; runtime.emit(run, 'stage_changed')
        try {
          const nextCandidates = async () => {
            discovery ??= await createCandidateDiscovery(runtime, run, save)
            return discovery.next(audience, yieldBetweenSteps)
          }
          candidates = runtime.store.withNocoBudgetMode
            ? await runtime.store.withNocoBudgetMode(run.runId, 'optional', nextCandidates)
            : await nextCandidates()
        } catch (error) {
          if (connectionErrorCode(error) !== 'connection_noco_budget_exhausted') throw error
          nocoBudgetExhausted = true; break
        }
        runtime.logger.event('candidate_discovery', 'succeeded', { ...details, audience,
          candidateCount: candidates.length })
        yield* checkpoint('candidate_page_saved')
      }
      if (await finishStopSafely()) return
      if (!candidates.length) {
        if (run.searchProgress.exhausted[audience]) continue
        continue
      }
      if (runtime.store.nocoBudgetCanStart && !runtime.store.nocoBudgetCanStart(
        run.runId, CONNECTION_NOCO_OPTIONAL_RESERVE)) {
        nocoBudgetExhausted = true; break
      }
      run.stage = 'sending'; await save(run, 'stage_changed')
      publisher ??= await createInvitationPublisher(runtime, run, save, reconciliation.snapshot)
      const result = await publisher.publish(audience, candidates, 1)
      const processed = new Set(result.processedPersonIds)
      run.searchProgress.pendingCandidates = run.searchProgress.pendingCandidates
        .filter(item => !processed.has(item.personId))
      if (await finishStopSafely()) return
      progress = progressFromCounters(run)
      runtime.emit(run, 'progress')
      yield* checkpoint('candidate_result_saved')
    }

    const finalHistory = await withConnectionRetry(runtime, run, save, 'storage',
      'final_history_readback', () => runtime.store.listRunHistory(run.runId, 1000))
    progress = synchronizeConfirmedProgress(run, finalHistory, run.audienceQuota)
    if (await holdUnsafeTerminal('resolving_uncertain', finalHistory)) return
    requireConnectionRunDay(runtime, run)

    if (confirmedQuotaExceeded(progress, run.audienceQuota)) {
      throw connectionError('connection_daily_quota_exceeded',
        'Confirmed invitation history exceeds the daily audience quota.')
    }
    const completed = !nocoBudgetExhausted && confirmedQuotaReached(progress, run.audienceQuota)
    run.status = completed ? 'succeeded' : 'partial'
    run.stage = completed ? 'completed' : nocoBudgetExhausted
      ? 'noco_budget_exhausted' : 'search_exhausted'
    run.errorCode = completed ? undefined : nocoBudgetExhausted
      ? 'connection_noco_budget_exhausted' : 'connection_search_space_exhausted'
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.executorId = undefined; run.heartbeatAt = undefined
    run.finishedAt = runtime.now().toISOString()
    await save(run, completed ? 'completed' : 'partial', 'critical')
    runtime.logger.event('run', completed ? 'succeeded' : 'failed', { ...details,
      sentCount: run.counters.sent, skippedCount: run.counters.skipped, runStage: run.stage,
      recruiterShortfall: progress.remaining.recruiter,
      technicalShortfall: progress.remaining.technical })
  } catch (error) {
    if (['connection_writer_service_stopped', 'automation_owner_lost'].includes(connectionErrorCode(error))) throw error
    if (runtime.stopRequested(run.runId)) {
      await finishStopSafely()
      return
    }
    const errorCode = connectionErrorCode(error)
    if (errorCode === 'connection_step_yield') {
      run.status = 'running'; await save(run, 'progress', 'critical'); return
    }
    if (errorCode === 'connection_daily_window_closed') {
      const closingHistory = await withConnectionRetry(runtime, run, save, 'storage',
        'day_close_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
        { allowAfterDayClose: true })
      if (await holdUnsafeTerminal('resolving_uncertain', closingHistory)) return
      await closeConnectionRunDay(runtime, run, save, closingHistory)
      return
    }
    if (['connection_search_space_exhausted', 'connection_search_contract_suspect'].includes(errorCode)) {
      const terminalHistory = await withConnectionRetry(runtime, run, save, 'storage',
        'partial_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
        { allowAfterDayClose: true })
      const terminalProgress = synchronizeConfirmedProgress(run, terminalHistory, run.audienceQuota)
      if (await holdUnsafeTerminal('resolving_uncertain', terminalHistory)) return
      run.status = 'partial'; run.stage = errorCode === 'connection_search_contract_suspect'
        ? 'search_contract_suspect' : 'search_exhausted'; run.errorCode = errorCode
      run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
      run.executorId = undefined; run.heartbeatAt = undefined
      run.finishedAt = runtime.now().toISOString()
      await save(run, 'partial', 'critical')
      runtime.logger.event('run', 'failed', { ...details, errorCode, runStatus: run.status,
        runStage: run.stage, sentCount: terminalProgress.sentTotal,
        recruiterShortfall: terminalProgress.remaining.recruiter,
        technicalShortfall: terminalProgress.remaining.technical })
      return
    }
    if (await holdUnsafeTerminal('resolving_uncertain')) return
    run.status = 'failed'; run.stage = 'failed'; run.errorCode = errorCode
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.executorId = undefined; run.heartbeatAt = undefined
    run.finishedAt = runtime.now().toISOString()
    runtime.logger.event('run', 'failed', { ...details, ...safeErrorDetails(error), errorCode,
      runStatus: run.status, runStage: run.stage })
    await save(run, 'stage_changed', 'critical')
  } finally {
    const currentStats = runtime.store.requestStats?.()
    const budget = runtime.store.nocoBudgetSnapshot?.(run.runId)
    const stats = currentStats && nocoStart ? {
      reads: currentStats.reads - nocoStart.reads,
      pages: currentStats.pages - nocoStart.pages,
      creates: currentStats.creates - nocoStart.creates,
      patches: currentStats.patches - nocoStart.patches,
      conflicts: currentStats.conflicts - nocoStart.conflicts,
      retries: currentStats.retries - nocoStart.retries
    } : currentStats
    if (stats) runtime.logger.event('noco_request_summary', 'succeeded', { ...details,
      nocoReads: stats.reads, nocoPages: stats.pages, nocoCreates: stats.creates,
      nocoPatches: stats.patches, nocoConflicts: stats.conflicts, nocoRetries: stats.retries,
      nocoRequests: stats.pages + stats.creates + stats.patches,
      nocoPhysicalAttempts: budget?.physicalAttempts,
      nocoPhysicalRetries: budget?.retryAttempts,
      nocoSafetyOverrun: budget?.safetyOverrun })
    if (release) {
      try {
        release(); runtime.logger.event('operation_gate_release', 'succeeded', details)
      } catch (error) {
        runtime.logger.event('operation_gate_release', 'failed', { ...details,
          errorCode: connectionErrorCode(error) })
      }
    }
    running.delete(run.runId)
  }
}

export function executeConnectionRun(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun, initialOpenHistory?: ConnectionHistoryItem[]) {
  const action = () => withConnectionRequestTrace(run, runtime.logger,
    async () => { for await (const _step of connectionSteps(runtime, run, running, save, initialOpenHistory, false)) {
      // Manual execution drives the same implementation continuously; the coordinator opts into handoffs.
    } })
  return runtime.store.runWithNocoBudget
    ? runtime.store.runWithNocoBudget(run, action)
    : action()
}
