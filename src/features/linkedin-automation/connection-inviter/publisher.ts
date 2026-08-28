import type { SearchAudience } from './catalog.ts'
import { connectionError, connectionErrorCode } from './errors.ts'
import { listAllPending } from './pending.ts'
import { profileAllowsInvitation } from './relation-policy.ts'
import { isUnknownWrite, sendDelay } from './run-model.ts'
import { waitOrStop } from './run-control.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'
import { invitationRequestId, pendingPersonId } from './unipile-adapter.ts'

async function skip(runtime: ConnectionRuntime, run: ConnectionRun, item: ConnectionHistoryItem,
  reasonCode: string) {
  item.status = 'skipped'; item.reasonCode = reasonCode; item.updatedAt = runtime.now().toISOString()
  await runtime.store.updateHistory(item); run.counters.skipped += 1
  runtime.logger.event('candidate_skip', 'succeeded', { runId: run.runId,
    platformAccountId: run.platformAccountId, audience: item.audience, reasonCode })
}

export async function publishInvitations(runtime: ConnectionRuntime, run: ConnectionRun,
  queues: Record<SearchAudience, ConnectionHistoryItem[]>, quota: Record<SearchAudience, number>,
  save: SaveRun) {
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  runtime.logger.event('invitation_publish', 'started', details)
  try {
    let pending = new Set((await listAllPending(runtime, run.accountId)).map(pendingPersonId).filter(Boolean))
    let sentAny = false
    audienceLoop: for (const audience of ['recruiter', 'technical'] as const) {
      for (const item of queues[audience].slice(0, quota[audience])) {
        if (runtime.stopRequested(run.runId)) break audienceLoop
        if (pending.has(item.personId)) { await skip(runtime, run, item, 'pending_invitation'); continue }
        const profile = await runtime.adapter().getProfile(run.accountId, item.personId)
        const preflight = profileAllowsInvitation(profile)
        if (!preflight.allowed) { await skip(runtime, run, item, preflight.reasonCode); continue }
        runtime.logger.event('candidate_preflight', 'succeeded', { ...details, audience,
          reasonCode: preflight.reasonCode })
        if (sentAny) {
          const delayMs = sendDelay(runtime.random)
          runtime.logger.event('invitation_delay', 'succeeded', { ...details, delayMs })
          if (!await waitOrStop(runtime, run.runId, delayMs)) break audienceLoop
        }
        if (runtime.stopRequested(run.runId)) break audienceLoop
        item.status = 'sending'; item.reasonCode = 'invitation_claimed'
        item.updatedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
        runtime.logger.event('invitation_claim', 'succeeded', { ...details, audience })
        let response: any
        runtime.logger.event('invitation_write', 'started', { ...details, audience })
        try { response = await runtime.adapter().sendInvitation(run.accountId, item.personId) }
        catch (error) {
          item.status = isUnknownWrite(error) ? 'uncertain' : 'failed'
          item.reasonCode = connectionErrorCode(error); item.sentAt = runtime.now().toISOString()
          item.updatedAt = item.sentAt; await runtime.store.updateHistory(item)
          if (item.status === 'uncertain') run.status = 'uncertain'
          runtime.logger.event('invitation_write', 'failed', { ...details, audience,
            errorCode: item.reasonCode, itemStatus: item.status })
          throw error
        }
        item.requestId = invitationRequestId(response); item.sentAt = runtime.now().toISOString()
        item.updatedAt = item.sentAt; item.status = 'uncertain'
        item.reasonCode = 'invitation_readback_pending'
        runtime.logger.event('invitation_write', 'succeeded', { ...details, audience,
          itemStatus: item.status, reasonCode: item.reasonCode })
        await runtime.store.updateHistory(item)
        run.stage = 'readback_pending'; await save(run)
        pending = new Set((await listAllPending(runtime, run.accountId))
          .map(pendingPersonId).filter(Boolean))
        if (!pending.has(item.personId)) {
          item.status = 'uncertain'; item.reasonCode = 'connection_invitation_readback_missing'
          await runtime.store.updateHistory(item); run.status = 'uncertain'
          runtime.logger.event('invitation_readback', 'failed', { ...details, audience,
            errorCode: item.reasonCode })
          throw connectionError('connection_invitation_readback_missing',
            'Invitation was not found during read-back.')
        }
        item.status = 'sent'; item.reasonCode = 'pending_readback_confirmed'
        item.verifiedAt = runtime.now().toISOString(); await runtime.store.updateHistory(item)
        run.counters.sent += 1; run.stage = 'sending'; sentAny = true; await save(run)
        runtime.logger.event('invitation_readback', 'succeeded', { ...details, audience,
          sentCount: run.counters.sent, reasonCode: item.reasonCode })
      }
    }
    runtime.logger.event('invitation_publish', 'succeeded', { ...details, sentCount: run.counters.sent })
  } catch (error) {
    runtime.logger.event('invitation_publish', 'failed', { ...details,
      errorCode: connectionErrorCode(error) }); throw error
  }
}
