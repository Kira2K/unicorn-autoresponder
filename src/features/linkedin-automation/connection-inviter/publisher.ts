import type { SearchAudience } from './catalog.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { listAllPending } from './pending.ts'
import { profileAllowsInvitation } from './relation-policy.ts'
import { isUnknownWrite, sendDelay } from './run-model.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { invitationRequestId, pendingPersonId } from './unipile-adapter.ts'

async function skip(runtime: ConnectionRuntime, run: ConnectionRun, item: ConnectionHistoryItem,
  reasonCode: string) {
  item.status = 'skipped'; item.reasonCode = reasonCode; item.updatedAt = runtime.now().toISOString()
  await runtime.store.updateHistory(item); run.counters.skipped += 1
}

export async function publishInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  queues: Record<SearchAudience, ConnectionHistoryItem[]>, quota: Record<SearchAudience, number>,
  save: SaveRun) {
  let pending = new Set((await listAllPending(runtime, run.accountId)).map(pendingPersonId).filter(Boolean))
  let sentAny = false
  for (const audience of ['recruiter', 'technical'] as const) {
    for (const item of queues[audience].slice(0, quota[audience])) {
      if (pending.has(item.personId)) { await skip(runtime, run, item, 'pending_invitation'); continue }
      const preflight = profileAllowsInvitation(await runtime.adapter().getProfile(run.accountId, item.personId))
      if (!preflight.allowed) { await skip(runtime, run, item, preflight.reasonCode); continue }
      if (sentAny) await runtime.sleep(sendDelay(runtime.random))
      item.status = 'sending'; item.reasonCode = 'invitation_claimed'
      item.updatedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
      let response: any
      try { response = await runtime.adapter().sendInvitation(run.accountId, item.personId) }
      catch (error) {
        item.status = isUnknownWrite(error) ? 'uncertain' : 'failed'
        item.reasonCode = connectionErrorCode(error); item.sentAt = runtime.now().toISOString()
        item.updatedAt = item.sentAt; await runtime.store.updateHistory(item)
        if (item.status === 'uncertain') run.status = 'uncertain'
        throw error
      }
      pending = new Set((await listAllPending(runtime, run.accountId)).map(pendingPersonId).filter(Boolean))
      item.requestId = invitationRequestId(response); item.sentAt = runtime.now().toISOString()
      item.updatedAt = item.sentAt
      if (!pending.has(item.personId)) {
        item.status = 'uncertain'; item.reasonCode = 'connection_invitation_readback_missing'
        await runtime.store.updateHistory(item); run.status = 'uncertain'
        throw connectionError('connection_invitation_readback_missing',
          'Invitation was not found during read-back.')
      }
      item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
      item.verifiedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
      run.counters.sent += 1; sentAny = true; await save(run)
    }
  }
}
