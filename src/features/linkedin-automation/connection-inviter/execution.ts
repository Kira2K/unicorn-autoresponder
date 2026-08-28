import { verifyConnectionAccount } from './account.mts'
import { discoverCandidates } from './discovery.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { dailyAudienceQuota, dateParts, weekdayQuota, weeklyAudienceTargets,
  weeklyInvitationLimit } from './limits.ts'
import { reconcileInvitations } from './pending.ts'
import { publishInvitations } from './publisher.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export async function executeConnectionRun(runtime: ConnectionRuntime, run: ConnectionRun,
  running: Set<string>, save: SaveRun) {
  if (running.has(run.runId) || run.status !== 'running') return
  running.add(run.runId); let release: (() => void) | undefined
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  runtime.logger.event('run', 'started', details)
  try {
    runtime.logger.event('operation_gate_acquire', 'started', details)
    try {
      release = runtime.gate?.acquire('connection_inviter', run.runId)
      runtime.logger.event('operation_gate_acquire', 'succeeded', details)
    } catch (error) {
      runtime.logger.event('operation_gate_acquire', 'failed', { ...details,
        errorCode: connectionErrorCode(error) })
      throw error
    }
    run.stage = 'verifying_account'; await save(run)
    await reconcileInvitations(runtime, run.accountId, run.platformAccountId)
    run.connectionCount = await verifyConnectionAccount(runtime, run)
    runtime.logger.event('account_verification', 'succeeded', { ...details,
      connectionCount: run.connectionCount })
    run.weeklyLimit = weeklyInvitationLimit(run.connectionCount)
    const date = dateParts(runtime.now(), runtime.timeZone)
    run.dailyQuota = weekdayQuota(run.weeklyLimit, date.isoWeekday)
    if (!run.dailyQuota) throw connectionError('connection_day_not_scheduled',
      'Manual invitations run only from Monday to Friday.')
    const planned = dailyAudienceQuota(run.weeklyLimit, date.isoWeekday)
    const sent = await runtime.store.weekSent(run.platformAccountId, run.weekKey)
    const targets = weeklyAudienceTargets(run.weeklyLimit)
    const used = { recruiter: sent.filter((item: any) => item.audience === 'recruiter').length,
      technical: sent.filter((item: any) => item.audience === 'technical').length }
    run.audienceQuota = {
      recruiter: Math.max(0, Math.min(planned.recruiter, targets.recruiter - used.recruiter)),
      technical: run.safeRecruiterOnly ? 0 : Math.max(0,
        Math.min(planned.technical, targets.technical - used.technical))
    }
    run.dailyQuota = run.audienceQuota.recruiter + run.audienceQuota.technical
    runtime.logger.event('quota_plan', 'succeeded', { ...details,
      connectionCount: run.connectionCount, weeklyLimit: run.weeklyLimit,
      dailyQuota: run.dailyQuota, recruiterQuota: run.audienceQuota.recruiter,
      technicalQuota: run.audienceQuota.technical, safeRecruiterOnly: run.safeRecruiterOnly })
    run.stage = 'searching'; await save(run)
    const queues = await discoverCandidates(runtime, run, run.audienceQuota, save)
    runtime.logger.event('candidate_discovery', 'succeeded', { ...details,
      candidateCount: queues.recruiter.length + queues.technical.length })
    run.stage = 'sending'; await save(run)
    await publishInvitations(runtime, run, queues, run.audienceQuota, save)
    run.status = 'succeeded'; run.stage = run.counters.sent ? 'completed' : 'completed_no_candidates'
    run.finishedAt = runtime.now().toISOString(); await save(run)
    runtime.logger.event('run', 'succeeded', { ...details, sentCount: run.counters.sent,
      skippedCount: run.counters.skipped, runStage: run.stage })
  } catch (error) {
    if (String(run.status) !== 'uncertain') run.status = 'failed'
    run.stage = String(run.status) === 'uncertain' ? 'readback_required' : 'failed'
    run.errorCode = connectionErrorCode(error); run.finishedAt = runtime.now().toISOString()
    runtime.logger.event('run', 'failed', { ...details, errorCode: run.errorCode,
      runStatus: run.status, runStage: run.stage })
    await save(run).catch(() => undefined)
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
