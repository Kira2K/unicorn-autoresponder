import { connectionErrorCode } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionHistoryItem } from './types.ts'

type PreflightResult = { ready: true } | { ready: false; sent: boolean }

export async function readInvitationProfile(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, operation: string, mandatoryReadback = false) {
  const { runtime, run, save, pending } = context
  return withConnectionRetry(runtime, run, save, 'unipile', operation, async () => {
    try { return await runtime.adapter().getProfile(run.accountId, item.personId) }
    catch (error) { pending.invalidate(connectionErrorCode(error)); throw error }
  }, { allowAfterDayClose: mandatoryReadback, ignoreStopRequested: mandatoryReadback })
}

async function abortBeforePost(context: InvitationSafetyContext, item: ConnectionHistoryItem,
  error: unknown): Promise<PreflightResult> {
  const errorCode = connectionErrorCode(error)
  if (!['connection_stop_requested', 'connection_daily_window_closed'].includes(errorCode)) {
    throw error
  }
  await context.history.release(item, errorCode)
  if (errorCode === 'connection_daily_window_closed') throw error
  return { ready: false, sent: false }
}

export async function prepareInvitation(context: InvitationSafetyContext,
  item: ConnectionHistoryItem): Promise<PreflightResult> {
  const { runtime, run, pending, history } = context
  if (runtime.stopRequested(run.runId)) {
    await history.release(item, 'connection_stop_requested')
    return { ready: false, sent: false }
  }
  try { requireConnectionRunDay(runtime, run) }
  catch (error) { return abortBeforePost(context, item, error) }

  let pendingIds: ReadonlySet<string>
  try { pendingIds = await pending.ensureFresh() }
  catch (error) { return abortBeforePost(context, item, error) }
  if (pendingIds.has(item.personId)) {
    await history.release(item, 'pending_invitation_pre_send', 'pending')
    history.countSkip(item, 'pending_invitation')
    return { ready: false, sent: false }
  }

  let profile: unknown
  try {
    profile = await readInvitationProfile(context, item, 'candidate_profile_after_claim')
    if (!pending.snapshot().valid) pendingIds = await pending.refresh()
  } catch (error) { return abortBeforePost(context, item, error) }
  if (pendingIds.has(item.personId)) {
    await history.release(item, 'pending_invitation_pre_send', 'pending')
    history.countSkip(item, 'pending_invitation')
    return { ready: false, sent: false }
  }
  if (profileIsConnected(profile)) {
    await history.release(item, 'existing_relation_pre_send', 'failed')
    history.countSkip(item, 'existing_relation')
    return { ready: false, sent: false }
  }
  if (runtime.stopRequested(run.runId)) {
    await history.release(item, 'connection_stop_requested')
    return { ready: false, sent: false }
  }
  try { requireConnectionRunDay(runtime, run) }
  catch (error) { return abortBeforePost(context, item, error) }

  const result = profileAllowsInvitation(profile)
  if (!result.allowed) {
    await history.release(item, result.reasonCode, 'failed')
    history.countSkip(item, result.reasonCode)
    return { ready: false, sent: false }
  }
  run.counters.filterFunnel[item.audience].preflightPassed += 1
  runtime.logger.event('candidate_preflight', 'succeeded', {
    runId: run.runId, platformAccountId: run.platformAccountId,
    audience: item.audience, reasonCode: result.reasonCode
  })
  return { ready: true }
}
