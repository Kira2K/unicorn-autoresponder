import { verifyConnectionAccount } from './account.mts'
import { nextConnectionAudience } from './audience-sequence.ts'
import { createCandidateDiscovery } from './discovery.ts'
import { remainingAudienceQuota } from './daily-progress.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { dailyAudienceTargets, dailyInvitationLimit } from './limits.ts'
import { reconcileInvitations } from './pending.ts'
import { createInvitationPublisher } from './publisher.ts'
import { finishRunStop } from './run-control.ts'
import { waitOrStop } from './run-control.ts'
import { withConnectionRetry } from './retry-state.ts'
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
  allowAfterDayClose = false) {
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
      if (!await waitOrStop(runtime, run.runId, delayMs,
        allowAfterDayClose ? undefined : run.localDate)) return undefined
      run.timerState = undefined; run.nextActionAt = undefined
    }
  }
}

export async function executeConnectionRun(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun) {
  if (running.has(run.runId) || run.status !== 'running' || !runtime.writerEnabled) return
  running.add(run.runId); let release: (() => void) | undefined
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  const nocoStart = runtime.store.requestStats?.()
  runtime.logger.event('run', 'started', details)
  try {
    const recoveringClosedDay = !connectionRunDayIsOpen(runtime, run)
    runtime.logger.event('operation_gate_acquire', 'started', details)
    release = await acquireAccountGate(runtime, run, save, recoveringClosedDay)
    if (runtime.stopRequested(run.runId)) { await finishRunStop(runtime, run, save); return }
    runtime.logger.event('operation_gate_acquire', 'succeeded', details)
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    run.stage = run.stage === 'recovering' ? 'recovering' : 'verifying_account'
    await save(run, 'stage_changed')
    const recoveredWait = Date.parse(run.nextActionAt ?? '') - runtime.now().getTime()
    if (!recoveringClosedDay && Number.isFinite(recoveredWait) && recoveredWait > 0) {
      if (!await waitOrStop(runtime, run.runId, recoveredWait, run.localDate)) {
        await finishRunStop(runtime, run, save); return
      }
      run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
      run.pausedAt = undefined; await save(run, 'retry_succeeded')
    }
    await reconcileInvitations(runtime, run, save)
    if (await finishRunStop(runtime, run, save)) return
    requireConnectionRunDay(runtime, run)
    run.stage = 'verifying_account'; await save(run, 'stage_changed')
    run.connectionCount = await withConnectionRetry(runtime, run, save, 'unipile',
      'account_verification', () => verifyConnectionAccount(runtime, run))
    runtime.logger.event('account_verification', 'succeeded', { ...details,
      connectionCount: run.connectionCount })
    run.dailyLimit = dailyInvitationLimit(run.connectionCount)
    const planned = dailyAudienceTargets(run.dailyLimit)
    run.audienceQuota = { recruiter: planned.recruiter,
      technical: run.safeRecruiterOnly ? 0 : planned.technical }
    run.dailyQuota = run.audienceQuota.recruiter + run.audienceQuota.technical
    const history = await withConnectionRetry(runtime, run, save, 'noco', 'run_history_list', () =>
      runtime.store.listRunHistory(run.runId, 1000))
    let progress = remainingAudienceQuota(run, history, run.audienceQuota)
    run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
    runtime.logger.event('quota_plan', 'succeeded', { ...details,
      connectionCount: run.connectionCount, dailyLimit: run.dailyLimit,
      dailyQuota: run.dailyQuota, recruiterQuota: run.audienceQuota.recruiter,
      technicalQuota: run.audienceQuota.technical, sentToday: progress.sentTotal,
      recruiterRemaining: progress.remaining.recruiter,
      technicalRemaining: progress.remaining.technical, safeRecruiterOnly: run.safeRecruiterOnly })
    if (await finishRunStop(runtime, run, save)) return

    const queuedIds = new Set(run.searchProgress.pendingCandidates.map(item => item.personId))
    for (const item of history.filter(candidate => candidate.status === 'deferred')) {
      if (!queuedIds.has(item.personId)) {
        run.searchProgress.pendingCandidates.push(item); queuedIds.add(item.personId)
      }
    }
    const publisher = await createInvitationPublisher(runtime, run, save)
    let discovery: Awaited<ReturnType<typeof createCandidateDiscovery>> | undefined

    while (!quotaEmpty(progress.remaining)) {
      requireConnectionRunDay(runtime, run)
      const audience = nextConnectionAudience(run.counters.sentByAudience, run.audienceQuota)
      if (!audience) break
      run.searchProgress.nextAudience = audience
      let candidates = run.searchProgress.pendingCandidates
        .filter(item => item.audience === audience)
      if (!candidates.length) {
        run.stage = 'searching'; await save(run, 'stage_changed')
        discovery ??= await createCandidateDiscovery(runtime, run, save)
        candidates = await discovery.next(audience)
        runtime.logger.event('candidate_discovery', 'succeeded', { ...details, audience,
          candidateCount: candidates.length })
      }
      if (await finishRunStop(runtime, run, save)) return
      if (!candidates.length) {
        if (run.searchProgress.exhausted[audience]) {
          throw connectionError('connection_search_space_exhausted',
            `Connection search exhausted for ${audience} before its quota was reached.`)
        }
        continue
      }
      run.stage = 'sending'; await save(run, 'stage_changed')
      const result = await publisher.publish(audience, candidates, 1)
      const processed = new Set(result.processedPersonIds)
      run.searchProgress.pendingCandidates = run.searchProgress.pendingCandidates
        .filter(item => !processed.has(item.personId))
      if (await finishRunStop(runtime, run, save)) return
      await save(run, 'progress')
      progress = progressFromCounters(run)
      runtime.emit(run, 'progress')
    }

    const finalHistory = await withConnectionRetry(runtime, run, save, 'noco',
      'final_history_readback', () => runtime.store.listRunHistory(run.runId, 1000))
    progress = remainingAudienceQuota(run, finalHistory, run.audienceQuota)
    run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
    requireConnectionRunDay(runtime, run)

    run.status = 'succeeded'; run.stage = 'completed'; run.errorCode = undefined
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.finishedAt = runtime.now().toISOString(); await save(run, 'completed', 'critical')
    runtime.logger.event('run', 'succeeded', { ...details, sentCount: run.counters.sent,
      skippedCount: run.counters.skipped, runStage: run.stage })
  } catch (error) {
    if (runtime.stopRequested(run.runId)) {
      await finishRunStop(runtime, run, save).catch(() => undefined)
      return
    }
    const errorCode = connectionErrorCode(error)
    if (errorCode === 'connection_daily_window_closed') {
      await closeConnectionRunDay(runtime, run, save).catch(() => undefined)
      return
    }
    if (errorCode === 'connection_search_space_exhausted') {
      run.status = 'partial'; run.stage = 'search_exhausted'; run.errorCode = errorCode
      run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
      run.finishedAt = runtime.now().toISOString()
      await save(run, 'partial', 'critical').catch(() => undefined)
      return
    }
    run.status = 'failed'; run.stage = 'failed'; run.errorCode = errorCode
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.finishedAt = runtime.now().toISOString()
    runtime.logger.event('run', 'failed', { ...details, errorCode,
      runStatus: run.status, runStage: run.stage,
      errorMessage: String((error as any)?.message ?? 'Connection run failed.').slice(0, 300) })
    await save(run, 'stage_changed', 'critical').catch(() => undefined)
  } finally {
    const currentStats = runtime.store.requestStats?.()
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
      nocoRequests: stats.pages + stats.creates + stats.patches })
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
