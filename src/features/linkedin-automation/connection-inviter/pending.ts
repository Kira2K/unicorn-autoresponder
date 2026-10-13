import { connectionError, connectionErrorCode, normalizeConnectionProviderError,
  transientConnectionError } from './errors.ts'
import { profileAllowsInvitation, profileIsConnected } from './relation-policy.ts'
import { withConnectionRetry } from './retry-state.ts'
import { beginInvitationVerification, deferInvitationVerification, clearInvitationVerification, recordInvitationFailure, expireInvitationRecovery } from './invitation-verification.ts'
import { ACTION_SKIPPED } from '../action-recovery.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { readPendingInvitations, type PendingRead } from './pending-reader.ts'
import { pendingReadIsFresh } from './pending-snapshot.ts'

const HISTORY_PROFILE_TTL_MS = 2 * 60 * 60_000

export async function listAllPending(runtime: ConnectionRuntime, accountId: string) {
  return (await readPendingInvitations(runtime, accountId)).items
}

export async function reconcileInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, options: { singlePass?: boolean; ignoreStopRequested?: boolean;
    runOnly?: boolean; openHistory?: ConnectionHistoryItem[]; snapshot?: PendingRead } = {}):
  Promise<{ unresolved: number; retryError?: unknown; snapshot?: PendingRead }> {
  const retryOptions = { allowAfterDayClose: true,
    ignoreStopRequested: options.ignoreStopRequested }
  let retryError: unknown
  const open = options.openHistory ?? await withConnectionRetry(runtime, run, save, 'storage',
    'open_history_list', () => runtime.store.listOpenHistory(run.platformAccountId, 1000), retryOptions)
  let active = options.runOnly ? open.filter(item => item.runId === run.runId) : open
  // A new run inherits duplicate protection, not permission to poll stopped runs.
  const stoppedRuns = new Set<string>()
  for (const id of new Set(active.map(item => item.runId).filter(id => id !== run.runId))) {
    const previous = await runtime.store.getRun(id)
    if (previous?.status === 'stopped' || previous?.stage === 'stop_requested') stoppedRuns.add(id)
  }
  active = active.filter(item => !stoppedRuns.has(item.runId))
  await expireInvitationRecovery(runtime, run, save, active)
  active = active.filter(item => item.reasonCode !== ACTION_SKIPPED)
  const unknown = active.filter(item => ['sending', 'uncertain'].includes(item.status))
  if (runtime.stopRequested(run.runId) && !options.ignoreStopRequested) return { unresolved: unknown.length }
  if (unknown.length) {
    if (!await beginInvitationVerification(runtime, run, save, unknown)) return { unresolved: unknown.length }
    // During recovery, spend requests on the unknown outcomes first, not all old receipts.
    active = unknown
  } else clearInvitationVerification(run)
  // Only known sent receipts may reuse a negative profile check in this same run.
  // The current pending list and every unknown result are still checked on every recovery.
  const checks = run.searchProgress.historyProfileChecks ??= {}
  const activeKeys = new Set(open.map(item => item.historyKey))
  for (const [key, check] of Object.entries(checks)) {
    const age = runtime.now().getTime() - check?.checkedAt
    if (!activeKeys.has(key) || !Number.isFinite(age) || age < 0 || age >= HISTORY_PROFILE_TTL_MS) delete checks[key]
  }
  if (active.some(item => ['sending', 'uncertain'].includes(item.status))) {
    // A crash may have happened after dispatch but before its run checkpoint.
    run.searchProgress.invitationPacingStarted = true
    run.searchProgress.invitationNotBefore = undefined
  }
  if (!active.length) {
    runtime.logger.event('invitation_reconcile', 'succeeded', {
      platformAccountId: run.platformAccountId, activeCount: 0 })
    return { unresolved: 0 }
  }
  const unipileRead = async <T>(operation: string, action: () => Promise<T>) => {
    if (!options.singlePass && !unknown.length) {
      return withConnectionRetry(runtime, run, save, 'unipile', operation, action, retryOptions)
    }
    try { return await action() }
    catch (caught) {
      const error = normalizeConnectionProviderError('unipile', caught)
      if (!transientConnectionError(error)) throw error
      retryError = error
      recordInvitationFailure(run, unknown, error, runtime.now().getTime())
      runtime.logger.event('invitation_reconcile', 'failed', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        errorCode: connectionErrorCode(error), reasonCode: 'single_pass_read_unavailable'
      })
      return undefined
    }
  }
  let accepted = 0
  let unresolved = 0
  const snapshot = options.snapshot?.complete && pendingReadIsFresh(options.snapshot, run.accountId, runtime.now().getTime())
    ? options.snapshot : await unipileRead('pending_invitations_read', () =>
      readPendingInvitations(runtime, run.accountId, active.length === 1 ? active[0].personId : undefined,
        options.ignoreStopRequested ? undefined : run.runId))
  if (!snapshot) {
    if (unknown.length) await deferInvitationVerification(runtime, run, save, retryError)
    return { unresolved: active.filter(item =>
      ['sending', 'uncertain'].includes(item.status)).length, retryError }
  }
  const pending = snapshot.personIds
  for (const item of active) {
    while (true) {
      if (runtime.stopRequested(run.runId) && !options.ignoreStopRequested) {
        return { unresolved: active.filter(candidate =>
          ['sending', 'uncertain'].includes(candidate.status)).length }
      }
      if (pending.has(item.personId)) {
        if (item.status !== 'sent') {
          item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
          item.verifiedAt = runtime.now().toISOString()
          await withConnectionRetry(runtime, run, save, 'storage', 'history_update', () =>
            runtime.store.updateHistory(item), retryOptions)
        }
        if (run.searchProgress.actionRecovery) delete run.searchProgress.actionRecovery[`invite:${item.personId}`]
        break
      }
      const signature = JSON.stringify([run.runId, run.accountId, item.platformAccountId,
        item.accountId, item.personId, item.status, item.sentAt, item.requestId, item.updatedAt])
      const cacheable = item.status === 'sent' && Number.isFinite(Date.parse(item.sentAt ?? '')) &&
        item.accountId === run.accountId && item.platformAccountId === run.platformAccountId
      const cached = checks[item.historyKey], checkedAt = runtime.now().getTime()
      if (cacheable && cached?.signature === signature && checkedAt >= cached.checkedAt &&
        checkedAt - cached.checkedAt < HISTORY_PROFILE_TTL_MS) {
        runtime.logger.event('invitation_reconcile', 'succeeded', { runId: run.runId,
          platformAccountId: run.platformAccountId, cacheUses: 1,
          reasonCode: 'sent_profile_check_reused', snapshotAgeMs: checkedAt - cached.checkedAt })
        break
      }
      const profile = await unipileRead('candidate_profile_readback', async () => {
        const result = await runtime.adapter().getProfile(run.accountId, item.personId)
        if (!result) throw connectionError('unipile_profile_readback_invalid',
          'Candidate profile read-back returned no result.', { httpStatus: 503 })
        return result
      })
      if (!profile) { unresolved += 1; break }
      if (profileIsConnected(profile)) {
        item.status = 'accepted'; item.reasonCode = 'connection_accepted'
        item.verifiedAt = runtime.now().toISOString()
        await withConnectionRetry(runtime, run, save, 'storage', 'history_update', () =>
          runtime.store.updateHistory(item), retryOptions)
        if (run.searchProgress.actionRecovery) delete run.searchProgress.actionRecovery[`invite:${item.personId}`]
        accepted += 1; break
      }
      if (cacheable && profileAllowsInvitation(profile).allowed) {
        checks[item.historyKey] = { signature, checkedAt }
        try { await save(run, 'progress', 'critical') }
        catch (error) { delete checks[item.historyKey]; throw error }
      }
      if (item.status === 'sent' || item.status === 'deferred') break
      if (item.status === 'sending') {
        item.status = 'uncertain'; item.reasonCode = 'connection_invitation_readback_missing'
        item.updatedAt = runtime.now().toISOString()
        await withConnectionRetry(runtime, run, save, 'storage', 'history_update', () =>
          runtime.store.updateHistory(item), retryOptions)
      }
      unresolved += 1
      break
    }
  }
  if (unknown.length) {
    if (unresolved) await deferInvitationVerification(runtime, run, save, retryError)
    else {
      clearInvitationVerification(run); await save(run, 'progress', 'critical')
      const rest = (options.runOnly ? open.filter(i => i.runId === run.runId) : open).filter(i => !unknown.includes(i) && i.reasonCode !== ACTION_SKIPPED)
      if (rest.length) return reconcileInvitations(runtime, run, save, { ...options, openHistory: rest, snapshot })
    }
  }
  runtime.logger.event('invitation_reconcile', 'succeeded', { platformAccountId: run.platformAccountId,
    activeCount: active.length, acceptedCount: accepted, unresolvedCount: unresolved })
  return { unresolved, snapshot, ...(retryError ? { retryError } : {}) }
}
