import { verifyConnectionAccount } from './account.mts'
import { nextConnectionAudience } from './audience-sequence.ts'
import { createCandidateDiscovery } from './discovery.ts'
import { confirmedQuotaExceeded, confirmedQuotaReached,
  synchronizeConfirmedProgress } from './daily-progress.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { dailyAudienceTargets, dailyInvitationLimit } from './limits.ts'
import { reconcileInvitations } from './pending.ts'
import { createInvitationPublisher } from './publisher.ts'
import { finishRunStop } from './run-control.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState, withConnectionRetry } from './retry-state.ts'
import { safeErrorDetails } from './logger.ts'
import { CONNECTION_NOCO_OPTIONAL_RESERVE } from './noco-budget.ts'
import { closeConnectionRunDay, connectionRunDayIsOpen,
  requireConnectionRunDay } from './day-window.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

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
      if (ignoreStopRequested) await runtime.sleep(delayMs)
      else if (!await waitOrStop(runtime, run.runId, delayMs,
        allowAfterDayClose ? undefined : run.localDate)) return undefined
      run.timerState = undefined; run.nextActionAt = undefined
    }
  }
}

async function executeConnectionRunWithBudget(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun) {
  if (running.has(run.runId) || run.status !== 'running' || !runtime.writerEnabled) return
  running.add(run.runId); let release: (() => void) | undefined
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  const nocoStart = runtime.store.requestStats?.()
  const holdUnsafeTerminal = async (stage: 'resolving_uncertain' | 'stop_requested') => {
    const open = await withConnectionRetry(runtime, run, save, 'noco',
      'terminal_open_history_readback', () => runtime.store.listOpenHistory(
        run.platformAccountId, 1000), { allowAfterDayClose: true, ignoreStopRequested: true })
    const unsafe = open.filter(item => item.runId === run.runId &&
      ['sending', 'uncertain'].includes(item.status))
    if (!unsafe.length) return false
    const pending = connectionError('unipile_terminal_readback_pending',
      'Invitation result must be resolved before a terminal run state.', { httpStatus: 503 })
    run.status = 'running'; run.stage = stage
    run.errorCode = 'connection_invitation_result_pending'
    run.retryState = makeRetryState(runtime, run, 'unipile',
      stage === 'stop_requested' ? 'stop_invitation_readback' : 'terminal_invitation_readback', pending)
    run.nextActionAt = run.retryState.nextRetryAt
    run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
      nextActionAt: run.retryState.nextRetryAt }
    run.finishedAt = undefined
    await save(run, 'retry_scheduled', 'critical')
    return true
  }
  const finishStopSafely = async () => {
    if (!runtime.stopRequested(run.runId)) return false
    if (!release && runtime.gate) {
      release = await acquireAccountGate(runtime, run, save, true, true)
    }
    const reconciliation = await reconcileInvitations(runtime, run, save,
      { singlePass: true, ignoreStopRequested: true, runOnly: true })
    if (reconciliation.unresolved && await holdUnsafeTerminal('stop_requested')) return true
    const stoppedHistory = await withConnectionRetry(runtime, run, save, 'noco',
      'stop_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
      { allowAfterDayClose: true, ignoreStopRequested: true })
    synchronizeConfirmedProgress(run, stoppedHistory, run.audienceQuota)
    return finishRunStop(runtime, run, save)
  }
  runtime.logger.event('run', 'started', details)
  try {
    const recoveringClosedDay = !connectionRunDayIsOpen(runtime, run)
    runtime.logger.event('operation_gate_acquire', 'started', details)
    release = await acquireAccountGate(runtime, run, save, recoveringClosedDay)
    if (await finishStopSafely()) return
    runtime.logger.event('operation_gate_acquire', 'succeeded', details)
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    run.stage = run.stage === 'recovering' ? 'recovering' : 'verifying_account'
    await save(run, 'stage_changed')
    const recoveredWait = Date.parse(run.nextActionAt ?? '') - runtime.now().getTime()
    if (!recoveringClosedDay && Number.isFinite(recoveredWait) && recoveredWait > 0) {
      if (!await waitOrStop(runtime, run.runId, recoveredWait, run.localDate)) {
        await finishStopSafely(); return
      }
      run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
      run.pausedAt = undefined; await save(run, 'retry_succeeded')
    }
    await reconcileInvitations(runtime, run, save)
    if (await finishStopSafely()) return
    requireConnectionRunDay(runtime, run)
    run.stage = 'verifying_account'; await save(run, 'stage_changed')
    const observedConnectionCount = await withConnectionRetry(runtime, run, save, 'unipile',
      'account_verification', () => verifyConnectionAccount(runtime, run))
    runtime.logger.event('account_verification', 'succeeded', { ...details,
      connectionCount: observedConnectionCount })
    const frozenQuota = run.dailyQuota !== undefined &&
      run.audienceQuota.recruiter + run.audienceQuota.technical > 0
    if (!frozenQuota) {
      run.connectionCount = observedConnectionCount
      run.dailyLimit = dailyInvitationLimit(observedConnectionCount)
      const planned = dailyAudienceTargets(run.dailyLimit)
      // Safe recruiter-only mode changes which audience can execute, not the frozen
      // business target. Keeping the full split makes the run partial until a stack
      // is selected, after which a same-day top-up can fill only the technical remainder.
      run.audienceQuota = planned
      run.dailyQuota = run.dailyLimit
    }
    const history = await withConnectionRetry(runtime, run, save, 'noco', 'run_history_list', () =>
      runtime.store.listRunHistory(run.runId, 1000))
    let progress = synchronizeConfirmedProgress(run, history, run.audienceQuota)
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
    const publisher = await createInvitationPublisher(runtime, run, save)
    let discovery: Awaited<ReturnType<typeof createCandidateDiscovery>> | undefined
    let nocoBudgetExhausted = false

    while (!quotaEmpty(progress.remaining)) {
      requireConnectionRunDay(runtime, run)
      const searchableQuota = {
        recruiter: run.searchProgress.exhausted.recruiter
          ? run.counters.sentByAudience.recruiter : run.audienceQuota.recruiter,
        technical: run.searchProgress.exhausted.technical
          ? run.counters.sentByAudience.technical : run.audienceQuota.technical
      }
      const audience = nextConnectionAudience(run.counters.sentByAudience, searchableQuota)
      if (!audience) break
      run.searchProgress.nextAudience = audience
      let candidates = run.searchProgress.pendingCandidates
        .filter(item => item.audience === audience)
      if (!candidates.length) {
        run.stage = 'searching'; await save(run, 'stage_changed')
        try {
          const nextCandidates = async () => {
            discovery ??= await createCandidateDiscovery(runtime, run, save)
            return discovery.next(audience)
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
      const result = await publisher.publish(audience, candidates, 1)
      const processed = new Set(result.processedPersonIds)
      run.searchProgress.pendingCandidates = run.searchProgress.pendingCandidates
        .filter(item => !processed.has(item.personId))
      if (await finishStopSafely()) return
      await save(run, 'progress')
      progress = progressFromCounters(run)
      runtime.emit(run, 'progress')
    }

    const finalHistory = await withConnectionRetry(runtime, run, save, 'noco',
      'final_history_readback', () => runtime.store.listRunHistory(run.runId, 1000))
    progress = synchronizeConfirmedProgress(run, finalHistory, run.audienceQuota)
    if (await holdUnsafeTerminal('resolving_uncertain')) return
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
    if (runtime.stopRequested(run.runId)) {
      await finishStopSafely()
      return
    }
    const errorCode = connectionErrorCode(error)
    if (errorCode === 'connection_daily_window_closed') {
      if (await holdUnsafeTerminal('resolving_uncertain')) return
      const closingHistory = await withConnectionRetry(runtime, run, save, 'noco',
        'day_close_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
        { allowAfterDayClose: true })
      await closeConnectionRunDay(runtime, run, save, closingHistory)
      return
    }
    if (['connection_search_space_exhausted', 'connection_search_contract_suspect'].includes(errorCode)) {
      const terminalHistory = await withConnectionRetry(runtime, run, save, 'noco',
        'partial_history_readback', () => runtime.store.listRunHistory(run.runId, 1000),
        { allowAfterDayClose: true })
      const terminalProgress = synchronizeConfirmedProgress(run, terminalHistory, run.audienceQuota)
      if (await holdUnsafeTerminal('resolving_uncertain')) return
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
  running: Set<string>, save: SaveRun) {
  const action = () => executeConnectionRunWithBudget(runtime, run, running, save)
  return runtime.store.runWithNocoBudget
    ? runtime.store.runWithNocoBudget(run, action)
    : action()
}
