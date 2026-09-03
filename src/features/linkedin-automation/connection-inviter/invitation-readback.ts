import { connectionError, connectionErrorCode } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { readInvitationProfile } from './invitation-profile.ts'
import { profileIsConnected } from './relation-policy.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState } from './retry-state.ts'
import type { ConnectionHistoryItem } from './types.ts'
import { invitationRequestId } from './unipile-adapter.ts'
import { clearInvitationRateLimitState } from './invitation-rate-limit.ts'

export async function resolveInvitationResult(context: InvitationSafetyContext,
  item: ConnectionHistoryItem) {
  const { runtime, run, save, pending, history } = context
  run.status = 'running'; run.stage = 'resolving_uncertain'
  await save(run, 'uncertain', 'critical')
  while (true) {
    const ids = await pending.refresh({ allowAfterDayClose: true,
      ignoreStopRequested: true, operation: 'invitation_pending_readback' })
    if (ids.has(item.personId)) { await history.confirm(item); return true }
    const profile = await readInvitationProfile(context, item,
      'candidate_profile_readback', true)
    if (profileIsConnected(profile)) { await history.confirm(item, 'accepted'); return true }

    const error = connectionError('unipile_readback_pending',
      'Invitation result is not visible yet.', { httpStatus: 503 })
    run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_result_readback', error)
    run.nextActionAt = run.retryState.nextRetryAt
    run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
      nextActionAt: run.retryState.nextRetryAt }
    if (runtime.stopRequested(run.runId)) {
      run.stage = 'stop_requested'; run.errorCode = 'connection_invitation_result_pending'
      await save(run, 'uncertain', 'critical')
      return false
    }
    run.stage = 'resolving_uncertain'
    await save(run, 'retry_scheduled', 'critical')
    if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) {
      run.stage = 'stop_requested'; run.errorCode = 'connection_invitation_result_pending'
      await save(run, 'uncertain', 'critical')
      return false
    }
  }
}

export async function readBackSuccessfulPost(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, response: unknown) {
  const { runtime, run, save, pending, history } = context
  clearInvitationRateLimitState(context)
  item.requestId = invitationRequestId(response)
  item.sentAt = runtime.now().toISOString(); item.updatedAt = item.sentAt
  item.status = 'uncertain'; item.reasonCode = 'invitation_readback_pending'
  let uncertainPersisted = false
  const persistUncertain = async (error?: unknown) => {
    if (uncertainPersisted) return
    if (error) item.reasonCode = connectionErrorCode(error)
    item.updatedAt = runtime.now().toISOString()
    await history.update(item)
    uncertainPersisted = true
  }
  run.stage = 'readback_pending'; await save(run, 'stage_changed')
  runtime.logger.event('invitation_write', 'succeeded', {
    runId: run.runId, platformAccountId: run.platformAccountId,
    audience: item.audience, itemStatus: item.status, reasonCode: item.reasonCode
  })
  try {
    const ids = await pending.refresh({ allowAfterDayClose: true,
      ignoreStopRequested: true, operation: 'invitation_pending_readback',
      onFirstTransientError: persistUncertain })
    if (ids.has(item.personId)) { await history.confirm(item); return true }
  } catch (error) {
    await persistUncertain(error)
    throw error
  }
  item.reasonCode = 'connection_invitation_readback_missing'
  await history.update(item)
  return resolveInvitationResult(context, item)
}
