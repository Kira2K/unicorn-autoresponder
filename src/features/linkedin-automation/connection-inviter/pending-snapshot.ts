import { connectionErrorCode } from './errors.ts'
import { readPendingInvitations } from './pending-reader.ts'
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
  findFresh(personId: string, options?: PendingReadOptions): Promise<boolean>
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

  const read = async (options: PendingReadOptions = {}, targetPersonId?: string) => {
    const operation = options.operation ?? 'pending_invitations_read'
    const result = await withConnectionRetry(runtime, run, save, 'unipile', operation,
      async () => {
        try { return await readPendingInvitations(runtime, run.accountId, targetPersonId) }
        catch (error) { invalidate(connectionErrorCode(error)); throw error }
      }, {
        allowAfterDayClose: options.allowAfterDayClose ?? false,
        ignoreStopRequested: options.ignoreStopRequested,
        onFirstTransientError: options.onFirstTransientError
      })
    const observed = new Set(result.items.map(pendingPersonId).filter(Boolean))
    if (result.complete) {
      personIds = observed
      refreshedAt = runtime.now().getTime()
      valid = true
    } else {
      // A partial positive read must not renew the full snapshot's freshness.
      for (const id of observed) personIds.add(id)
    }
    runtime.logger.event('pending_snapshot', 'succeeded', {
      runId: run.runId, platformAccountId: run.platformAccountId,
      pendingCount: personIds.size, snapshotAgeMs: Math.max(0, runtime.now().getTime() - refreshedAt),
      snapshotFresh: result.complete
    })
    return observed as ReadonlySet<string>
  }
  const refresh = (options?: PendingReadOptions) => read(options)

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
    async findFresh(personId, options) { return (await read(options, personId)).has(personId) },
    snapshot
  }
  await controller.refresh()
  return controller
}
