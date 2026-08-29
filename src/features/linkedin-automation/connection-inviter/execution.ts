import { verifyConnectionAccount } from './account.mts'
import { discoverCandidates } from './discovery.ts'
import { remainingAudienceQuota } from './daily-progress.ts'
import { connectionErrorCode } from './errors.ts'
import { dailyAudienceTargets, dailyInvitationLimit } from './limits.ts'
import { reconcileInvitations } from './pending.ts'
import { publishInvitations } from './publisher.ts'
import { finishRunStop } from './run-control.ts'
import { waitOrStop } from './run-control.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

const quotaEmpty = (quota: { recruiter: number; technical: number }) =>
  quota.recruiter <= 0 && quota.technical <= 0

const queuedProgressCandidates = (run: ConnectionRun) => ({
  recruiter: run.searchProgress.pendingCandidates.filter(item => item.audience === 'recruiter'),
  technical: run.searchProgress.pendingCandidates.filter(item => item.audience === 'technical')
})

async function acquireAccountGate(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun) {
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
      if (!await waitOrStop(runtime, run.runId, delayMs)) return undefined
      run.timerState = undefined; run.nextActionAt = undefined
    }
  }
}

export async function executeConnectionRun(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun) {
  if (running.has(run.runId) || run.status !== 'running' || !runtime.writerEnabled) return
  running.add(run.runId); let release: (() => void) | undefined
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  runtime.logger.event('run', 'started', details)
  try {
    runtime.logger.event('operation_gate_acquire', 'started', details)
    release = await acquireAccountGate(runtime, run, save)
    if (runtime.stopRequested(run.runId)) { await finishRunStop(runtime, run, save); return }
    runtime.logger.event('operation_gate_acquire', 'succeeded', details)
    run.executorId = runtime.writerId; run.heartbeatAt = runtime.now().toISOString()
    run.stage = run.stage === 'recovering' ? 'recovering' : 'verifying_account'
    await save(run, 'stage_changed')
    const recoveredWait = Date.parse(run.nextActionAt ?? '') - runtime.now().getTime()
    if (Number.isFinite(recoveredWait) && recoveredWait > 0) {
      if (!await waitOrStop(runtime, run.runId, recoveredWait)) {
        await finishRunStop(runtime, run, save); return
      }
      run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
      run.pausedAt = undefined; await save(run, 'retry_succeeded')
    }
    await reconcileInvitations(runtime, run, save)
    if (await finishRunStop(runtime, run, save)) return
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
    const history = await withConnectionRetry(runtime, run, save, 'noco', 'history_list', () =>
      runtime.store.listHistory(run.platformAccountId, 1000))
    let progress = remainingAudienceQuota(run, history, run.audienceQuota)
    run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
    runtime.logger.event('quota_plan', 'succeeded', { ...details,
      connectionCount: run.connectionCount, dailyLimit: run.dailyLimit,
      dailyQuota: run.dailyQuota, recruiterQuota: run.audienceQuota.recruiter,
      technicalQuota: run.audienceQuota.technical, sentToday: progress.sentTotal,
      recruiterRemaining: progress.remaining.recruiter,
      technicalRemaining: progress.remaining.technical, safeRecruiterOnly: run.safeRecruiterOnly })
    if (await finishRunStop(runtime, run, save)) return

    const deferred = { recruiter: history.filter(item => item.status === 'deferred' &&
      item.audience === 'recruiter'), technical: history.filter(item => item.status === 'deferred' &&
      item.audience === 'technical') }
    if (deferred.recruiter.length || deferred.technical.length) {
      run.stage = 'sending'; await save(run, 'stage_changed')
      await publishInvitations(runtime, run, deferred, progress.remaining, save)
      const refreshed = await withConnectionRetry(runtime, run, save, 'noco', 'history_list', () =>
        runtime.store.listHistory(run.platformAccountId, 1000))
      progress = remainingAudienceQuota(run, refreshed, run.audienceQuota)
      run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
    }

    if (run.searchProgress.pendingCandidates.length && !quotaEmpty(progress.remaining)) {
      run.stage = 'sending'; await save(run, 'stage_changed')
      await publishInvitations(runtime, run, queuedProgressCandidates(run), progress.remaining, save)
      if (await finishRunStop(runtime, run, save)) return
      run.searchProgress.pendingCandidates = []; await save(run, 'progress')
      const refreshed = await withConnectionRetry(runtime, run, save, 'noco', 'history_list', () =>
        runtime.store.listHistory(run.platformAccountId, 1000))
      progress = remainingAudienceQuota(run, refreshed, run.audienceQuota)
      run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
    }

    while (!quotaEmpty(progress.remaining)) {
      run.stage = 'searching'; await save(run, 'stage_changed')
      const queues = await discoverCandidates(runtime, run, progress.remaining, save)
      runtime.logger.event('candidate_discovery', 'succeeded', { ...details,
        candidateCount: queues.recruiter.length + queues.technical.length })
      if (await finishRunStop(runtime, run, save)) return
      if (queues.recruiter.length || queues.technical.length) {
        run.stage = 'sending'; await save(run, 'stage_changed')
        await publishInvitations(runtime, run, queues, progress.remaining, save)
        if (await finishRunStop(runtime, run, save)) return
        run.searchProgress.pendingCandidates = []; await save(run, 'progress')
      }
      const refreshedHistory = await withConnectionRetry(runtime, run, save, 'noco',
        'history_list', () => runtime.store.listHistory(run.platformAccountId, 1000))
      progress = remainingAudienceQuota(run, refreshedHistory, run.audienceQuota)
      run.counters.sent = progress.sentTotal; run.counters.sentByAudience = progress.sent
      runtime.emit(run, 'progress')
      if (quotaEmpty(progress.remaining)) break
      const exhausted = (progress.remaining.recruiter <= 0 || run.searchProgress.exhausted.recruiter) &&
        (progress.remaining.technical <= 0 || run.searchProgress.exhausted.technical)
      if (exhausted) {
        run.status = 'partial'; run.stage = 'search_exhausted'
        run.errorCode = `search_exhausted_recruiter_${progress.remaining.recruiter}` +
          `_technical_${progress.remaining.technical}`
        run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
        run.finishedAt = runtime.now().toISOString(); await save(run, 'partial')
        runtime.logger.event('run', 'succeeded', { ...details, sentCount: run.counters.sent,
          skippedCount: run.counters.skipped, runStage: run.stage })
        return
      }
    }

    run.status = 'succeeded'; run.stage = 'completed'; run.errorCode = undefined
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.finishedAt = runtime.now().toISOString(); await save(run, 'completed')
    runtime.logger.event('run', 'succeeded', { ...details, sentCount: run.counters.sent,
      skippedCount: run.counters.skipped, runStage: run.stage })
  } catch (error) {
    if (runtime.stopRequested(run.runId)) {
      await finishRunStop(runtime, run, save).catch(() => undefined)
      return
    }
    const errorCode = connectionErrorCode(error)
    run.status = 'failed'; run.stage = 'failed'; run.errorCode = errorCode
    run.retryState = undefined; run.timerState = undefined; run.nextActionAt = undefined
    run.finishedAt = runtime.now().toISOString()
    runtime.logger.event('run', 'failed', { ...details, errorCode,
      runStatus: run.status, runStage: run.stage })
    await save(run, 'stage_changed').catch(() => undefined)
  } finally {
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
