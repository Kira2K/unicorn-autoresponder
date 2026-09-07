import { connectionErrorCode } from './errors.ts'
import { listAllPending } from './pending.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'
import { pendingPersonId } from './unipile-adapter.ts'

export const PENDING_SNAPSHOT_TTL_MS = 5 * 60_000

export type PendingSnapshot = {
  personIds: ReadonlySet<string>
  refreshedAt: number
  valid: boolean
}

type PendingReadOptions = {
  allowAfterDayClose?: boolean
  ignoreStopRequested?: boolean
  operation?: string
  onFirstTransientError?: (error: unknown) => Promise<void>
}

export type PendingSnapshotController = {
  has(personId: string): boolean
  add(personId: string): void
  invalidate(reasonCode: string): void
  ensureFresh(options?: PendingReadOptions): Promise<ReadonlySet<string>>
  refresh(options?: PendingReadOptions): Promise<ReadonlySet<string>>
  snapshot(): PendingSnapshot
}

export async function createPendingSnapshotController(runtime: ConnectionRuntime,
  run: ConnectionRun, save: SaveRun): Promise<PendingSnapshotController> {
  let personIds = new Set<string>()
  let refreshedAt = 0
  let valid = false

  const snapshot = (): PendingSnapshot => ({
    personIds: new Set(personIds), refreshedAt, valid
  })

  const invalidate = (reasonCode: string) => {
    valid = false
    runtime.logger.event('pending_snapshot', 'failed', {
      runId: run.runId, platformAccountId: run.platformAccountId, reasonCode
    })
  }

  const refresh = async (options: PendingReadOptions = {}) => {
    const operation = options.operation ?? 'pending_invitations_read'
    const rows = await withConnectionRetry(runtime, run, save, 'unipile', operation,
      async () => {
        try { return await listAllPending(runtime, run.accountId) }
        catch (error) { invalidate(connectionErrorCode(error)); throw error }
      }, {
        allowAfterDayClose: options.allowAfterDayClose ?? false,
        ignoreStopRequested: options.ignoreStopRequested,
        onFirstTransientError: options.onFirstTransientError
      })
    personIds = new Set(rows.map(pendingPersonId).filter(Boolean))
    refreshedAt = runtime.now().getTime()
    valid = true
    runtime.logger.event('pending_snapshot', 'succeeded', {
      runId: run.runId, platformAccountId: run.platformAccountId,
      pendingCount: personIds.size, snapshotAgeMs: 0, snapshotFresh: true
    })
    return personIds as ReadonlySet<string>
  }

  const controller: PendingSnapshotController = {
    has(personId) { return valid && personIds.has(personId) },
    add(personId) { personIds.add(personId) },
    invalidate,
    async ensureFresh(options = {}) {
      const snapshotAgeMs = refreshedAt ? Math.max(0, runtime.now().getTime() - refreshedAt) : 0
      if (!valid || !refreshedAt || snapshotAgeMs > PENDING_SNAPSHOT_TTL_MS) {
        return refresh(options)
      }
      runtime.logger.event('pending_snapshot', 'succeeded', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        pendingCount: personIds.size, snapshotAgeMs, snapshotFresh: true,
        reasonCode: 'pending_snapshot_reused'
      })
      return personIds
    },
    refresh,
    snapshot
  }
  await controller.refresh()
  return controller
}
