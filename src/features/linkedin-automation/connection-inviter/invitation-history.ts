import { claimRunCandidate } from './history-claim.ts'
import type { PendingSnapshotController } from './pending-snapshot.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export type InvitationHistoryController = {
  claim(item: ConnectionHistoryItem): Promise<ConnectionHistoryItem | undefined>
  update(item: ConnectionHistoryItem): Promise<void>
  release(item: ConnectionHistoryItem, reasonCode: string,
    status?: 'deferred' | 'failed' | 'pending'): Promise<void>
  countSkip(item: ConnectionHistoryItem, reasonCode: string): void
  confirm(item: ConnectionHistoryItem, status?: 'sent' | 'accepted'): Promise<void>
}

export function createInvitationHistoryController(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun, pending: PendingSnapshotController): InvitationHistoryController {
  const update = async (item: ConnectionHistoryItem) => {
    await withConnectionRetry(runtime, run, save, 'noco', 'history_update', () =>
      runtime.store.updateHistory(item), { allowAfterDayClose: true })
  }

  const countSkip = (item: ConnectionHistoryItem, reasonCode: string) => {
    run.counters.skipped += 1
    const hardKey = `hard:${reasonCode}`
    const audienceKey = `audience:${item.audience}:hard:${reasonCode}`
    run.skipReasonCounters[hardKey] = (run.skipReasonCounters[hardKey] ?? 0) + 1
    run.skipReasonCounters[audienceKey] = (run.skipReasonCounters[audienceKey] ?? 0) + 1
    runtime.logger.event('candidate_skip', 'succeeded', {
      runId: run.runId, platformAccountId: run.platformAccountId,
      audience: item.audience, reasonCode
    })
  }

  return {
    claim(item) {
      return withConnectionRetry(runtime, run, save, 'noco', 'history_claim', () =>
        claimRunCandidate(runtime.store, item))
    },
    update,
    async release(item, reasonCode, status = 'deferred') {
      item.status = status; item.reasonCode = reasonCode
      item.updatedAt = runtime.now().toISOString()
      await update(item)
    },
    countSkip,
    async confirm(item, status = 'sent') {
      item.status = status
      item.reasonCode = status === 'accepted' ? 'connection_accepted' : 'pending_readback_confirmed'
      item.verifiedAt = runtime.now().toISOString()
      await update(item)
      pending.add(item.personId)
      run.counters.sent += 1
      run.counters.sentByAudience[item.audience] += 1
      run.counters.filterFunnel[item.audience].sent += 1
      run.stage = 'sending'
      await save(run, 'invitation_sent')
      runtime.logger.event('invitation_readback', 'succeeded', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        audience: item.audience, sentCount: run.counters.sent, reasonCode: item.reasonCode
      })
    }
  }
}
