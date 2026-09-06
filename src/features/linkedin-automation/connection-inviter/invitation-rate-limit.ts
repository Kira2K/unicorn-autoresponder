import { connectionErrorCode } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { readInvitationProfile } from './invitation-profile.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { makeRetryState } from './retry-state.ts'
import { waitOrStop } from './run-control.ts'
import type { ConnectionHistoryItem } from './types.ts'

export type RateLimitRecovery =
  { retry: true; item: ConnectionHistoryItem } | { retry: false; sent: boolean }

function schedule(context: InvitationSafetyContext, error: unknown) {
  const { runtime, run } = context
  run.invitationRetryState = makeRetryState(runtime, run, 'unipile', 'invitation_write', error,
    run.invitationRetryState)
  run.retryState = run.invitationRetryState
  run.status = 'running'; run.stage = 'waiting_retry'; run.errorCode = run.retryState.errorCode
  run.nextActionAt = run.retryState.nextRetryAt; run.pausedAt = runtime.now().toISOString()
  run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
    nextActionAt: run.retryState.nextRetryAt }
}

export function clearInvitationRateLimitState(context: InvitationSafetyContext,
  preserveAttempt = false) {
  const { runtime, run } = context
  run.retryState = undefined
  if (!preserveAttempt) run.invitationRetryState = undefined
  run.timerState = undefined; run.nextActionAt = undefined
  run.pausedAt = undefined; run.errorCode = undefined
  run.stage = runtime.stopRequested(run.runId) ? 'stop_requested' : 'sending'
  runtime.emit(run, 'retry_succeeded')
}

export async function recoverInvitationRateLimit(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, error: unknown): Promise<RateLimitRecovery> {
  const { runtime, run, save, pending, history } = context
  const errorCode = connectionErrorCode(error)
  pending.invalidate(errorCode)
  item.status = 'deferred'; item.reasonCode = errorCode
  item.updatedAt = runtime.now().toISOString(); await history.update(item)
  schedule(context, error); await save(run, 'retry_scheduled', 'critical')
  const continued = await waitOrStop(runtime, run.runId, run.retryState!.delayMs, run.localDate)
  if (!continued) return { retry: false, sent: false }

  const ids = await pending.refresh({ allowAfterDayClose: true,
    ignoreStopRequested: true, operation: 'invitation_pending_readback' })
  clearInvitationRateLimitState(context, true); await save(run, 'retry_succeeded', 'critical')
  if (ids.has(item.personId)) {
    clearInvitationRateLimitState(context); await history.confirm(item)
    return { retry: false, sent: true }
  }

  const profile = await readInvitationProfile(context, item, 'candidate_profile_readback', true)
  if (profileIsConnected(profile)) {
    clearInvitationRateLimitState(context); await history.confirm(item, 'accepted')
    return { retry: false, sent: true }
  }
  if (runtime.stopRequested(run.runId)) {
    clearInvitationRateLimitState(context); return { retry: false, sent: false }
  }
  requireConnectionRunDay(runtime, run)
  const preflight = profileAllowsInvitation(profile)
  if (!preflight.allowed) {
    clearInvitationRateLimitState(context)
    item.status = 'failed'; item.reasonCode = preflight.reasonCode
    item.updatedAt = runtime.now().toISOString(); await history.update(item)
    history.countSkip(item, preflight.reasonCode)
    return { retry: false, sent: false }
  }

  item.status = 'sending'; item.reasonCode = 'invitation_claimed'
  item.updatedAt = runtime.now().toISOString()
  const reclaimed = await history.claim(item)
  if (!reclaimed) {
    clearInvitationRateLimitState(context)
    history.countSkip(item, 'invitation_claim_not_confirmed')
    return { retry: false, sent: false }
  }
  return { retry: true, item: reclaimed }
}
