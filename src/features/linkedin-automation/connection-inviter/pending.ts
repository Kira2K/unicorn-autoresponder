import { connectionError } from './errors.ts'
import { profileIsConnected } from './relation-policy.ts'
import { waitOrStop } from './run-control.ts'
import { makeRetryState, withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'
import { connectionPageItems, pendingPersonId } from './unipile-adapter.ts'

export async function listAllPending(runtime: ConnectionRuntime, accountId: string) {
  const result: any[] = []; let offset = 0
  for (let page = 0; page < 20; page += 1) {
    const response = await runtime.adapter().listPendingInvitations(accountId, offset)
    const items = connectionPageItems(response)
    if (!items.length) {
      runtime.logger.event('pending_read', 'succeeded', { pendingCount: result.length, page: page + 1 })
      return result
    }
    result.push(...items); offset += items.length
  }
  runtime.logger.event('pending_read', 'failed', { pendingCount: result.length, page: 20,
    errorCode: 'pending_invitations_truncated' })
  throw connectionError('pending_invitations_truncated',
    'Pending invitations exceeded the safe read-back pagination limit.')
}

export async function reconcileInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun) {
  const active = await withConnectionRetry(runtime, run, save, 'noco', 'open_history_list', () =>
    runtime.store.listOpenHistory(run.platformAccountId, 1000), { allowAfterDayClose: true })
  if (!active.length) {
    runtime.logger.event('invitation_reconcile', 'succeeded', {
      platformAccountId: run.platformAccountId, activeCount: 0 })
    return
  }
  let accepted = 0
  const initialPendingRows = await withConnectionRetry(runtime, run, save, 'unipile',
    'pending_invitations_read', () => listAllPending(runtime, run.accountId),
    { allowAfterDayClose: true })
  let pending = new Set(initialPendingRows.map(pendingPersonId).filter(Boolean))
  for (const item of active) {
    while (true) {
      if (runtime.stopRequested(run.runId)) return
      if (pending.has(item.personId)) {
        if (item.status !== 'sent') {
          item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
          item.verifiedAt = runtime.now().toISOString()
          await withConnectionRetry(runtime, run, save, 'noco', 'history_update', () =>
            runtime.store.updateHistory(item), { allowAfterDayClose: true })
        }
        break
      }
      const profile = await withConnectionRetry(runtime, run, save, 'unipile',
        'candidate_profile_readback', () => runtime.adapter().getProfile(run.accountId, item.personId),
        { allowAfterDayClose: true })
      if (profileIsConnected(profile)) {
        item.status = 'accepted'; item.reasonCode = 'connection_accepted'
        item.verifiedAt = runtime.now().toISOString()
        await withConnectionRetry(runtime, run, save, 'noco', 'history_update', () =>
          runtime.store.updateHistory(item), { allowAfterDayClose: true })
        accepted += 1; break
      }
      if (item.status === 'sent' || item.status === 'deferred') break
      const synthetic = connectionError('unipile_readback_pending',
        'Invitation result is not visible yet.', { httpStatus: 503 })
      run.status = 'running'; run.stage = 'resolving_uncertain'
      run.retryState = makeRetryState(runtime, run, 'unipile', 'invitation_result_readback', synthetic)
      run.nextActionAt = run.retryState.nextRetryAt
      run.timerState = { kind: 'overload_backoff', delayMs: run.retryState.delayMs,
        nextActionAt: run.retryState.nextRetryAt }
      await save(run, 'retry_scheduled', 'critical')
      if (!await waitOrStop(runtime, run.runId, run.retryState.delayMs)) return
      const pendingRows = await withConnectionRetry(runtime, run, save, 'unipile',
        'pending_invitations_read', () => listAllPending(runtime, run.accountId),
        { allowAfterDayClose: true })
      pending = new Set(pendingRows.map(pendingPersonId).filter(Boolean))
    }
  }
  runtime.logger.event('invitation_reconcile', 'succeeded', { platformAccountId: run.platformAccountId,
    activeCount: active.length, acceptedCount: accepted })
}
