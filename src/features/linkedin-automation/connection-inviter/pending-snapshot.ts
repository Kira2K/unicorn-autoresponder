import { connectionError, connectionErrorCode } from './errors.ts'
import { readPendingInvitations, type PendingRead } from './pending-reader.ts'
import { withConnectionRetry } from './retry-state.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import type { ConnectionRun } from './types.ts'
import { recordPendingReuse } from './logger.ts'

export const PENDING_SNAPSHOT_TTL_MS = 5 * 60_000
export type PendingSnapshot = PendingRead & { valid: boolean }

export function pendingReadIsFresh(read: PendingRead | undefined, accountId: string, now: number) {
  return Boolean(read && read.accountId === accountId && Number.isFinite(read.refreshedAt) &&
    read.refreshedAt <= now && now - read.refreshedAt <= PENDING_SNAPSHOT_TTL_MS &&
    (!('valid' in read) || read.valid === true))
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
  findFresh(personId: string, options?: PendingReadOptions): Promise<PendingRead>
  snapshot(): PendingSnapshot
}

export async function createPendingSnapshotController(runtime: ConnectionRuntime,
  run: ConnectionRun, save: SaveRun, seed?: PendingRead): Promise<PendingSnapshotController> {
  const accountId = run.accountId
  let personIds = new Set<string>(); let refreshedAt = 0; let valid = false
  const details = { runId: run.runId, platformAccountId: run.platformAccountId }
  const snapshot = (): PendingSnapshot => ({
    accountId, personIds: new Set(personIds), complete: valid, refreshedAt, valid
  })
  const assertAccount = () => {
    if (accountId !== run.accountId) {
      valid = false
      throw connectionError('connection_account_changed', 'Invitation snapshot belongs to another account.')
    }
  }
  const invalidate = (reasonCode: string) => {
    valid = false
    runtime.logger.event('pending_snapshot', 'failed', { ...details, reasonCode })
  }
  const accept = (read: PendingRead) => {
    if (read.complete) {
      personIds = new Set(read.personIds); refreshedAt = read.refreshedAt; valid = true
    } else {
      // Positive partial read-back adds known IDs, but never renews the full list's age.
      for (const id of read.personIds) personIds.add(id)
    }
  }
  const read = async (targetPersonId?: string, options: PendingReadOptions = {}) => {
    assertAccount()
    let result: PendingRead
    do {
      if (!options.ignoreStopRequested && runtime.stopRequested(run.runId)) {
        throw connectionError('connection_stop_requested', 'Connection run stop was requested.')
      }
      result = await withConnectionRetry(runtime, run, save, 'unipile',
        options.operation ?? 'pending_invitations_read', async () => {
          try {
            const value = await readPendingInvitations(runtime, accountId, targetPersonId)
            if (!pendingReadIsFresh(value, accountId, runtime.now().getTime())) {
              throw connectionError('unipile_pending_snapshot_expired',
                'Pending invitations expired during the scan.', { httpStatus: 503 })
            }
            return value
          } catch (error) { invalidate(connectionErrorCode(error)); throw error }
        }, { allowAfterDayClose: options.allowAfterDayClose ?? false,
          ignoreStopRequested: options.ignoreStopRequested,
          onFirstTransientError: options.onFirstTransientError })
      // Persisting the retry's outcome may itself take longer than the snapshot's TTL.
      if (!pendingReadIsFresh(result, accountId, runtime.now().getTime())) {
        invalidate('pending_read_expired_during_save')
      }
    } while (!pendingReadIsFresh(result, accountId, runtime.now().getTime()))
    assertAccount()
    accept(result)
    runtime.logger.event('pending_snapshot', 'succeeded', { ...details,
      pendingCount: personIds.size, snapshotAgeMs: runtime.now().getTime() - refreshedAt,
      snapshotFresh: valid && pendingReadIsFresh(snapshot(), accountId, runtime.now().getTime()),
      reasonCode: result.complete ? 'pending_full_refresh' : 'pending_partial_confirmation' })
    return result
  }
  const refresh = async (options?: PendingReadOptions) => (await read(undefined, options)).personIds
  const controller: PendingSnapshotController = {
    has(personId) {
      const found = pendingReadIsFresh(snapshot(), run.accountId, runtime.now().getTime()) && personIds.has(personId)
      if (found) recordPendingReuse('pending_candidate_cache_hit')
      return found
    },
    add(personId) { personIds.add(personId) },
    invalidate,
    async ensureFresh(options = {}) {
      assertAccount()
      const snapshotAgeMs = runtime.now().getTime() - refreshedAt
      if (!pendingReadIsFresh(snapshot(), accountId, runtime.now().getTime())) {
        runtime.logger.event('pending_snapshot', 'started', { ...details, snapshotAgeMs,
          reasonCode: valid ? 'pending_snapshot_expired' : 'pending_snapshot_invalid' })
        return refresh(options)
      }
      recordPendingReuse('pending_snapshot_reused')
      runtime.logger.event('pending_snapshot', 'succeeded', { ...details,
        pendingCount: personIds.size, snapshotAgeMs, snapshotFresh: true,
        reasonCode: 'pending_snapshot_reused' })
      return personIds
    },
    refresh,
    findFresh: read,
    snapshot
  }
  if (seed?.complete === true && pendingReadIsFresh(seed, accountId, runtime.now().getTime())) {
    accept(seed)
    recordPendingReuse('pending_reconciliation_reused')
    runtime.logger.event('pending_snapshot', 'succeeded', { ...details,
      snapshotAgeMs: runtime.now().getTime() - refreshedAt, reasonCode: 'pending_reconciliation_reused' })
  } else {
    const reasonCode = !seed ? 'pending_seed_missing'
      : seed.accountId !== accountId ? 'pending_seed_account_mismatch'
      : seed.complete !== true ? 'pending_seed_incomplete'
      : 'valid' in seed && seed.valid !== true ? 'pending_seed_invalid'
      : !Number.isFinite(seed.refreshedAt) || seed.refreshedAt > runtime.now().getTime()
        ? 'pending_seed_timestamp_invalid' : 'pending_seed_expired'
    runtime.logger.event('pending_snapshot', 'started', { ...details,
      reasonCode })
    await controller.refresh()
  }
  return controller
}
