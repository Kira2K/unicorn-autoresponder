import type { InvitationHistoryController } from './invitation-history.ts'
import type { PendingSnapshotController } from './pending-snapshot.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'

export type InvitationSafetyContext = {
  runtime: ConnectionRuntime
  run: ConnectionRun
  save: SaveRun
  pending: PendingSnapshotController
  history: InvitationHistoryController
}
