import type { SearchAudience } from './catalog.ts'
import { connectionError, connectionErrorCode, connectionHttpStatus } from './errors.ts'
import { claimRunCandidate } from './history-claim.ts'
import { listAllPending } from './pending.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { isUnknownWrite, sendDelay } from './run-model.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState, waitWithRunTimer, withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { invitationRequestId, pendingPersonId } from './unipile-adapter.ts'

const AUDIENCES: SearchAudience[] = ['recruiter', 'technical']

async function updateHistory(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  await withConnectionRetry(runtime, run, save, 'noco', 'history_update', () =>
    runtime.store.updateHistory(item))
}

function countSkip(runtime: ConnectionRuntime, run: ConnectionRun, item: ConnectionHistoryItem,
  reasonCode: string) {
  run.counters.skipped += 1
  const hardKey = `hard:${reasonCode}`
  const audienceKey = `audience:${item.audience}:hard:${reasonCode}`
  run.skipReasonCounters[hardKey] = (run.skipReasonCounters[hardKey] ?? 0) + 1
  run.skipReasonCounters[audienceKey] = (run.skipReasonCounters[audienceKey] ?? 0) + 1
  runtime.logger.event('candidate_skip', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience: item.audience, reasonCode })
}

async function claim(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  return withConnectionRetry(runtime, run, save, 'noco', 'history_claim', () =>
    claimRunCandidate(runtime.store, item))
}

async function pendingIds(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun) {
  const rows = await withConnectionRetry(runtime, run, save, 'unipile',
    'pending_invitations_read', () => listAllPending(runtime, run.accountId))
  return new Set(rows.map(pendingPersonId).filter(Boolean))
}

async function confirmSent(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
  item.verifiedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
  run.counters.sent += 1
  run.counters.sentByAudience[item.audience] += 1
  run.counters.filterFunnel[item.audience].sent += 1
  run.stage = 'sending'; await save(run, 'invitation_sent')
  runtime.logger.event('invitation_readback', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience: item.audience,
    sentCount: run.counters.sent, reasonCode: item.reasonCode })
}

async function resolveUncertain(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  run.status = 'running'; run.stage = 'resolving_uncertain'
  await save(run, 'uncertain', 'critical')
  while (true) {
    const pending = await pendingIds(runtime, run, save)
    if (pending.has(item.personId)) { await confirmSent(runtime, run, save, item); return true }
    const profile = await withConnectionRetry(runtime, run, save, 'unipile',
      'candidate_profile_readback', () => runtime.adapter().getProfile(run.accountId, item.personId))
    if (profileIsConnected(profile)) { await confirmSent(runtime, run, save, item); return true }
    const synthetic = connectionError('unipile_readback_pending',
      'Invitation result is not visible yet.', { httpStatus: 503 })
    run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_result_readback', synthetic)
    run.stage = 'resolving_uncertain'; run.nextActionAt = run.retryState.nextRetryAt
    run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
      nextActionAt: run.retryState.nextRetryAt }
    await save(run, 'retry_scheduled', 'critical')
    if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) return false
  }
}

async function sendWithSafety(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun,
  item: ConnectionHistoryItem) {
  while (true) {
    runtime.logger.event('invitation_write', 'started', { runId: run.runId,
      platformAccountId: run.platformAccountId, audience: item.audience })
    try {
      const response = await runtime.adapter().sendInvitation(run.accountId, item.personId)
      item.requestId = invitationRequestId(response); item.sentAt = runtime.now().toISOString()
      item.updatedAt = item.sentAt; item.status = 'uncertain'
      item.reasonCode = 'invitation_readback_pending'; await updateHistory(runtime, run, save, item)
      run.stage = 'readback_pending'; await save(run, 'stage_changed')
      runtime.logger.event('invitation_write', 'succeeded', { runId: run.runId,
        platformAccountId: run.platformAccountId, audience: item.audience,
        itemStatus: item.status, reasonCode: item.reasonCode })
      if ((await pendingIds(runtime, run, save)).has(item.personId)) {
        await confirmSent(runtime, run, save, item); return true
      }
      item.reasonCode = 'connection_invitation_readback_missing'
      await updateHistory(runtime, run, save, item)
      return resolveUncertain(runtime, run, save, item)
    } catch (error) {
      const status = connectionHttpStatus(error)
      const errorCode = connectionErrorCode(error)
      if (status === 429) {
        if ((await pendingIds(runtime, run, save)).has(item.personId)) {
          await confirmSent(runtime, run, save, item); return true
        }
        item.status = 'deferred'; item.reasonCode = errorCode
        item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
        run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_write', error)
        run.stage = 'waiting_retry'; run.nextActionAt = run.retryState.nextRetryAt
        run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
          nextActionAt: run.retryState.nextRetryAt }
        await save(run, 'retry_scheduled', 'critical')
        if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) return false
        item.status = 'sending'; item.reasonCode = 'invitation_claimed'
        item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
        continue
      }
      if (isUnknownWrite(error) || (status !== undefined && status >= 500)) {
        item.status = 'uncertain'; item.reasonCode = errorCode
        item.sentAt = runtime.now().toISOString(); item.updatedAt = item.sentAt
        await updateHistory(runtime, run, save, item)
        runtime.logger.event('invitation_write', 'failed', { runId: run.runId,
          platformAccountId: run.platformAccountId, audience: item.audience,
          errorCode, itemStatus: item.status })
        return resolveUncertain(runtime, run, save, item)
      }
      if (status !== undefined && status >= 400 && status < 500) {
        item.status = 'failed'; item.reasonCode = errorCode
        item.updatedAt = runtime.now().toISOString(); await updateHistory(runtime, run, save, item)
        countSkip(runtime, run, item, errorCode); return false
      }
      throw error
    }
  }
}

export async function publishInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  queues: Record<SearchAudience, ConnectionHistoryItem[]>, quota: Record<SearchAudience, number>,
  save: SaveRun) {
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  runtime.logger.event('invitation_publish', 'started', details)
  let pending = await pendingIds(runtime, run, save)
  let sentAny = run.counters.sent > 0
  try {
    audienceLoop: for (const audience of AUDIENCES) {
      let audienceSent = 0
      for (const candidate of queues[audience]) {
        if (audienceSent >= quota[audience]) break
        if (runtime.stopRequested(run.runId)) break audienceLoop
        if (pending.has(candidate.personId)) {
          countSkip(runtime, run, candidate, 'pending_invitation'); continue
        }
        const profile = await withConnectionRetry(runtime, run, save, 'unipile',
          'candidate_profile_read', () => runtime.adapter().getProfile(run.accountId, candidate.personId))
        const preflight = profileAllowsInvitation(profile)
        if (!preflight.allowed) {
          countSkip(runtime, run, candidate, preflight.reasonCode); continue
        }
        run.counters.filterFunnel[audience].preflightPassed += 1
        runtime.logger.event('candidate_preflight', 'succeeded', { ...details, audience,
          reasonCode: preflight.reasonCode })
        if (sentAny) {
          const delayMs = sendDelay(runtime.random)
          runtime.logger.event('invitation_delay', 'succeeded', { ...details, delayMs })
          if (!await waitWithRunTimer(runtime, run, save, 'invitation_delay',
            'invitation_delay', delayMs, true)) break audienceLoop
        }
        if (runtime.stopRequested(run.runId)) break audienceLoop
        candidate.status = 'sending'; candidate.reasonCode = 'invitation_claimed'
        candidate.updatedAt = runtime.now().toISOString()
        const item = await claim(runtime, run, save, candidate)
        if (!item) { countSkip(runtime, run, candidate, 'lifetime_history_block'); continue }
        run.counters.filterFunnel[audience].claimed += 1
        run.stage = 'sending'; await save(run, 'stage_changed')
        runtime.logger.event('invitation_claim', 'succeeded', { ...details, audience })
        if (await sendWithSafety(runtime, run, save, item)) {
          audienceSent += 1; sentAny = true; pending.add(item.personId)
        }
      }
    }
    runtime.logger.event('invitation_publish', 'succeeded', { ...details, sentCount: run.counters.sent })
  } catch (error) {
    runtime.logger.event('invitation_publish', 'failed', { ...details,
      errorCode: connectionErrorCode(error) }); throw error
  }
}
