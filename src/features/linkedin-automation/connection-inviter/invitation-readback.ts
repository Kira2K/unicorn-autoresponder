import { connectionError, normalizeConnectionProviderError, transientConnectionError } from './errors.ts'
import type { InvitationSafetyContext } from './invitation-context.ts'
import { profileIsConnected } from './relation-policy.ts'
import type { ConnectionHistoryItem } from './types.ts'
import { invitationRequestId, confirmedInvitationReceipt } from './unipile-adapter.ts'
import { clearInvitationRateLimitState } from './invitation-rate-limit.ts'
import { readPendingInvitations, type PendingRead } from './pending-reader.ts'
import { beginInvitationVerification, deferInvitationVerification, clearInvitationVerification, clearVerificationWait, recordInvitationFailure } from './invitation-verification.ts'
import { pendingReadIsFresh } from './pending-snapshot.ts'
import { recordPendingReuse } from './logger.ts'

export async function resolveInvitationResult(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, initialRead?: PendingRead) {
  const { runtime, run, save, pending, history } = context
  if (runtime.stopRequested(run.runId)) return false
  if (await beginInvitationVerification(runtime, run, save, [item])) {
    try {
      const reusable = initialRead?.complete === true && initialRead.targetPersonId === item.personId &&
        initialRead.refreshedAt >= Date.parse(item.sentAt ?? '') &&
        pendingReadIsFresh(initialRead, run.accountId, runtime.now().getTime())
      const read = reusable ? initialRead! : await readPendingInvitations(runtime, run.accountId, item.personId, run.runId)
      if (reusable) recordPendingReuse('pending_readback_reused')
      let accepted = false
      if (!read.personIds.has(item.personId)) {
        if (runtime.stopRequested(run.runId)) return false
        const profile = await runtime.adapter().getProfile(run.accountId, item.personId)
        if (!profile) throw connectionError('unipile_profile_readback_invalid', 'Empty profile.', { httpStatus: 503 })
        accepted = profileIsConnected(profile)
      }
      if (accepted || read.personIds.has(item.personId)) {
        await history.confirm(item, accepted ? 'accepted' : 'sent')
        const verification = run.searchProgress.invitationVerification
        if (verification?.personIds) {
          verification.personIds = verification.personIds.filter(id => id !== item.personId)
          if (!verification.personIds.length) clearInvitationVerification(run)
        }
        pending.add(item.personId)
        return true
      }
    } catch (caught) {
      if (runtime.stopRequested(run.runId)) return false
      const error = normalizeConnectionProviderError('unipile', caught)
      if (!transientConnectionError(error)) throw error
      recordInvitationFailure(run, [item], error, runtime.now().getTime())
      await deferInvitationVerification(runtime, run, save, error)
    }
  }
  // The candidate keeps its durable reservation; other recipients may use the remaining quota.
  if (!(Date.parse(run.searchProgress.invitationVerification?.blockedUntil ?? '') > runtime.now().getTime()))
    clearVerificationWait(run)
  return false
}

export async function readBackSuccessfulPost(context: InvitationSafetyContext,
  item: ConnectionHistoryItem, response: unknown) {
  const { runtime, run, save, pending, history } = context
  clearInvitationRateLimitState(context)
  item.requestId = invitationRequestId(response)
  item.sentAt = runtime.now().toISOString(); item.updatedAt = item.sentAt
  if (confirmedInvitationReceipt(response, run.accountId, item.personId)) {
    // The V2 adapter validated HTTP 201, sent type, provider request ID and target binding.
    // Unknown outcomes still use the original read-back path below.
    await history.confirm(item, 'sent', 'invitation_receipt_confirmed')
    runtime.logger.event('invitation_write', 'succeeded', { runId: run.runId,
      platformAccountId: run.platformAccountId, reasonCode: 'invitation_receipt_confirmed' })
    return true
  }
  item.status = 'uncertain'; item.reasonCode = 'invitation_readback_pending'
  await history.update(item)
  run.stage = 'readback_pending'; await save(run, 'stage_changed', 'critical')
  runtime.logger.event('invitation_write', 'succeeded', {
    runId: run.runId, platformAccountId: run.platformAccountId,
    audience: item.audience, itemStatus: item.status, reasonCode: item.reasonCode
  })
  return resolveInvitationResult(context, item)
}
