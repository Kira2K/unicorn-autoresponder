import { connectionError } from './errors.ts'
import { profileIsConnected } from './relation-policy.ts'
import type { ConnectionRuntime } from './runtime.ts'
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

export async function reconcileInvitations(runtime: ConnectionRuntime, accountId: string,
  platformAccountId: number) {
  const history = await runtime.store.listHistory(platformAccountId, 1000)
  const active = history.filter((item: any) => item.status === 'sent' || item.status === 'uncertain')
  if (!active.length) {
    runtime.logger.event('invitation_reconcile', 'succeeded', { platformAccountId, activeCount: 0 })
    return
  }
  const pending = new Set((await listAllPending(runtime, accountId)).map(pendingPersonId).filter(Boolean))
  let unresolved = false; let accepted = 0
  for (const item of active) {
    if (pending.has(item.personId)) {
      if (item.status === 'uncertain') {
        item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
        item.verifiedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
      }
      continue
    }
    const profile = await runtime.adapter().getProfile(accountId, item.personId)
    if (profileIsConnected(profile)) {
      item.status = 'accepted'; item.reasonCode = 'connection_accepted'
      item.verifiedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
      accepted += 1
    } else if (item.status === 'uncertain') unresolved = true
  }
  if (unresolved) {
    runtime.logger.event('invitation_reconcile', 'failed', { platformAccountId,
      activeCount: active.length, acceptedCount: accepted, pendingCount: pending.size,
      errorCode: 'connection_uncertain_requires_review' })
    throw connectionError('connection_uncertain_requires_review',
      'A previous invitation still has an uncertain result.')
  }
  runtime.logger.event('invitation_reconcile', 'succeeded', { platformAccountId,
    activeCount: active.length, acceptedCount: accepted, pendingCount: pending.size })
}
