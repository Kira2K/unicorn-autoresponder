import { connectionError, connectionErrorCode, connectionHttpStatus, normalizeConnectionProviderError } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { requireConnectionRunDay } from './day-window.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionHistoryItem, ConnectionInvitationProfile } from './types.ts'
import { PENDING_SNAPSHOT_TTL_MS } from './pending-snapshot.ts'
import { recordPendingReuse } from './logger.ts'
import { evaluateCandidate, parseConnectionCandidate } from './policy.ts'

type PreflightResult = { ready: true } | { ready: false; sent: boolean }

export async function readInvitationProfile(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, operation: string, mandatoryReadback = false) {
  const { runtime, run, save, pending } = context
  return withConnectionRetry<ConnectionInvitationProfile>(runtime, run, save, 'unipile', operation, async () => {
    try {
      const adapter = runtime.adapter()
      if (!mandatoryReadback && adapter.getInvitationProfile) {
        return await adapter.getInvitationProfile(run.accountId, item.personId)
      }
      return { profile: await adapter.getProfile(run.accountId, item.personId),
        accountId: run.accountId, personId: item.personId }
    }
    catch (caught) {
      const error = normalizeConnectionProviderError('unipile', caught)
      const code = connectionErrorCode(error)
      const status = connectionHttpStatus(error) ?? 0
      const readUnavailable = ['unipile_timeout', 'unipile_unreachable'].includes(code) ||
        (code.startsWith('unipile_') && status >= 500 && status <= 599)
      if (mandatoryReadback || !readUnavailable) pending.invalidate(code)
      throw error
    }
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
  if (pending.snapshot().accountId !== run.accountId || item.accountId !== run.accountId) {
    throw connectionError('connection_account_changed', 'Invitation account changed during the run.')
  }
  if (runtime.stopRequested(run.runId)) {
    await history.release(item, 'connection_stop_requested')
    return { ready: false, sent: false }
  }
  try { requireConnectionRunDay(runtime, run) }
  catch (error) { return abortBeforePost(context, item, error) }

  if (pending.has(item.personId)) {
    await history.release(item, 'pending_invitation_pre_send', 'pending')
    history.countSkip(item, 'pending_invitation')
    return { ready: false, sent: false }
  }

  let read: ConnectionInvitationProfile
  try {
    read = await readInvitationProfile(context, item, 'candidate_profile_after_claim')
  } catch (error) { return abortBeforePost(context, item, error) }
  const profile = read.profile
  if (read.accountId !== run.accountId || read.personId !== item.personId ||
    (profile?.object === 'UserProfile' && profile.id !== item.personId)) {
    await history.release(item, 'candidate_profile_identity_mismatch', 'failed')
    history.countSkip(item, 'candidate_profile_identity_mismatch')
    return { ready: false, sent: false }
  }
  const observedAt = read.pendingStateObservedAt
  const profileFresh = read.accountId === run.accountId && read.personId === item.personId &&
    observedAt !== undefined && Number.isFinite(observedAt) && observedAt <= runtime.now().getTime() &&
    runtime.now().getTime() - observedAt <= PENDING_SNAPSHOT_TTL_MS
  let pendingIds: ReadonlySet<string> = new Set()
  if (profileFresh) {
    recordPendingReuse('pending_candidate_profile_reused')
    runtime.logger.event('pending_snapshot', 'succeeded', { runId: run.runId,
      reasonCode: 'pending_candidate_profile_reused', snapshotAgeMs: runtime.now().getTime() - observedAt! })
  } else {
    runtime.logger.event('pending_snapshot', 'started', { runId: run.runId,
      reasonCode: 'pending_profile_evidence_unavailable' })
    try { pendingIds = await pending.ensureFresh() }
    catch (error) { return abortBeforePost(context, item, error) }
  }
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
  if (run.searchProgress.carriedCandidateIds?.includes(item.personId)) {
    // Cached search cards must still match the CURRENT name/headline and audience.
    const current = parseConnectionCandidate({ id: read.profile?.id,
      display_name: read.profile?.display_name, headline: read.profile?.description,
      location: read.profile?.specifics?.location ?? read.profile?.location,
      network_distance: read.profile?.specifics?.network_distance })
    const policy = evaluateCandidate(current, { audience: item.audience, city: item.location },
      run.stack, run.safeRecruiterOnly)
    if (!profileFresh || !policy.eligible) {
      const reason = !profileFresh ? 'cached_candidate_profile_unverified' : policy.reasonCode
      await history.release(item, reason, 'failed'); history.countSkip(item, reason)
      return { ready: false, sent: false }
    }
  }
  run.counters.filterFunnel[item.audience].preflightPassed += 1
  runtime.logger.event('candidate_preflight', 'succeeded', {
    runId: run.runId, platformAccountId: run.platformAccountId,
    audience: item.audience, reasonCode: result.reasonCode
  })
  return { ready: true }
}
