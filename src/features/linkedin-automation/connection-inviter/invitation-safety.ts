import { createInvitationHistoryController } from './invitation-history.ts'
import { createPendingSnapshotController } from './pending-snapshot.ts'
import { sendInvitationSafely } from './invitation-write.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionHistoryItem, ConnectionRun } from './types.ts'

export type InvitationSafety = {
  candidateIsPending(personId: string): boolean
  claim(item: ConnectionHistoryItem): Promise<ConnectionHistoryItem | undefined>
  countSkip(item: ConnectionHistoryItem, reasonCode: string): void
  send(item: ConnectionHistoryItem): Promise<boolean>
}

export async function createInvitationSafety(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun): Promise<InvitationSafety> {
  const pending = await createPendingSnapshotController(runtime, run, save)
  const history = createInvitationHistoryController(runtime, run, save, pending)
  const context = { runtime, run, save, pending, history }
  return {
    candidateIsPending(personId) { return pending.has(personId) },
    claim(item) { return history.claim(item) },
    countSkip(item, reasonCode) { history.countSkip(item, reasonCode) },
    send(item) { return sendInvitationSafely(context, item) }
  }
}
