import { connectionError, connectionErrorCode, normalizeConnectionProviderError,
  transientConnectionError } from './errors.ts'
import { profileIsConnected } from './relation-policy.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState, withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { readPendingInvitations, type PendingRead } from './pending-reader.ts'

export async function listAllPending(runtime: ConnectionRuntime, accountId: string) {
  return (await readPendingInvitations(runtime, accountId)).items
}

export async function reconcileInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, options: { singlePass?: boolean; ignoreStopRequested?: boolean;
    runOnly?: boolean; openHistory?: ConnectionHistoryItem[] } = {}):
  Promise<{ unresolved: number; retryError?: unknown; snapshot?: PendingRead }> {
  const retryOptions = { allowAfterDayClose: true,
    ignoreStopRequested: options.ignoreStopRequested }
  let retryError: unknown
  const open = options.openHistory ?? await withConnectionRetry(runtime, run, save, 'storage',
    'open_history_list', () => runtime.store.listOpenHistory(run.platformAccountId, 1000), retryOptions)
  const active = options.runOnly ? open.filter(item => item.runId === run.runId) : open
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
    if (!options.singlePass) {
      return withConnectionRetry(runtime, run, save, 'unipile', operation, action, retryOptions)
    }
    try { return await action() }
    catch (caught) {
      const error = normalizeConnectionProviderError('unipile', caught)
      if (!transientConnectionError(error)) throw error
      retryError = error
      runtime.logger.event('invitation_reconcile', 'failed', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        errorCode: connectionErrorCode(error), reasonCode: 'single_pass_read_unavailable'
      })
      return undefined
    }
  }
  let accepted = 0
  let unresolved = 0
  let snapshot = await unipileRead('pending_invitations_read', () =>
    readPendingInvitations(runtime, run.accountId))
  if (!snapshot) {
    return { unresolved: active.filter(item =>
      ['sending', 'uncertain'].includes(item.status)).length, retryError }
  }
  let pending = snapshot.personIds
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
        accepted += 1; break
      }
      if (item.status === 'sent' || item.status === 'deferred') break
      if (item.status === 'sending') {
        item.status = 'uncertain'; item.reasonCode = 'connection_invitation_readback_missing'
        item.updatedAt = runtime.now().toISOString()
        await withConnectionRetry(runtime, run, save, 'storage', 'history_update', () =>
          runtime.store.updateHistory(item), retryOptions)
      }
      if (options.singlePass) {
        unresolved += 1
        break
      }
      const synthetic = connectionError('unipile_readback_pending',
        'Invitation result is not visible yet.', { httpStatus: 503 })
      run.status = 'running'; run.stage = 'resolving_uncertain'
      run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_result_readback', synthetic)
      run.nextActionAt = run.retryState.nextRetryAt
      run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
        nextActionAt: run.retryState.nextRetryAt }
      await save(run, 'retry_scheduled', 'critical')
      const continued = options.ignoreStopRequested
        ? (await runtime.sleep(run.retryState.delayMs), true)
        : await waitOrStop(runtime, run.runId, run.retryState.delayMs)
      if (!continued) {
        return { unresolved: Math.max(1, active.filter(candidate =>
          ['sending', 'uncertain'].includes(candidate.status)).length) }
      }
      snapshot = await withConnectionRetry(runtime, run, save, 'unipile',
        'pending_invitations_read', () => readPendingInvitations(runtime, run.accountId),
        retryOptions)
      pending = snapshot.personIds
    }
  }
  runtime.logger.event('invitation_reconcile', 'succeeded', { platformAccountId: run.platformAccountId,
    activeCount: active.length, acceptedCount: accepted, unresolvedCount: unresolved })
  return { unresolved, snapshot, ...(retryError ? { retryError } : {}) }
}
