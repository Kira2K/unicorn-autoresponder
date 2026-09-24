import { connectionError } from './errors.ts'
import type { ConnectionRuntime } from './runtime.ts'
import { parseConnectionPendingResponse, pendingPersonId } from './unipile-adapter.ts'

export type PendingRead = {
  accountId: string
  personIds: ReadonlySet<string>
  complete: boolean
  refreshedAt: number
  targetPersonId?: string
}

// Absence requires a complete valid scan. A positive match can stop pagination early.
// Timestamp the oldest page, so a long scan does not make old data look new.
export async function readPendingInvitations(runtime: ConnectionRuntime, accountId: string,
  targetPersonId?: string): Promise<PendingRead & { items: any[] }> {
  const refreshedAt = runtime.now().getTime()
  const result: any[] = []; let offset = 0; let cursor: string | undefined
  let expectedTotal: number | undefined
  const seenCursors = new Set<string>(); const personIds = new Set<string>()
  const invalid = (message: string): never => {
    throw connectionError('unipile_pending_pagination_invalid', message, { httpStatus: 503 })
  }
  const finish = (complete: boolean, page: number) => {
    runtime.logger.event('pending_read', 'succeeded', {
      pendingCount: result.length, page, complete,
      reasonCode: complete ? 'pending_scan_complete' : 'pending_target_found'
    })
    return { accountId, personIds, complete, refreshedAt, targetPersonId, items: result }
  }
  for (let page = 0; page < 20; page += 1) {
    const response = await runtime.adapter().listPendingInvitations(accountId, cursor ?? offset)
    const { items, nextCursor, totalCount, hasMore } = parseConnectionPendingResponse(response)
    if (totalCount !== undefined) {
      if (expectedTotal !== undefined && totalCount !== expectedTotal) {
        invalid('Pending invitations returned conflicting page totals.')
      }
      expectedTotal = totalCount
    }
    if ((hasMore === true && !nextCursor) || (hasMore === false && nextCursor)) {
      invalid('Pending invitations returned conflicting pagination metadata.')
    }
    if (nextCursor && (!items.length || nextCursor === cursor || seenCursors.has(nextCursor))) {
      invalid('Pending invitations returned an unsafe cursor chain.')
    }
    const pageIds = items.map(pendingPersonId)
    if (new Set(pageIds).size !== pageIds.length || pageIds.some(id => personIds.has(id))) {
      invalid('Pending invitations repeated a page item.')
    }
    if (!items.length) {
      if (expectedTotal !== undefined && result.length < expectedTotal) {
        invalid('Pending invitations ended before the declared total.')
      }
      return finish(true, page + 1)
    }
    for (const id of pageIds) personIds.add(id)
    result.push(...items)
    if (expectedTotal !== undefined && (result.length > expectedTotal ||
      (nextCursor && result.length >= expectedTotal))) {
      invalid('Pending invitations exceeded the declared total.')
    }
    if (!nextCursor && cursor && expectedTotal !== undefined && result.length < expectedTotal) {
      invalid('Pending invitations cursor chain ended before the declared total.')
    }
    const complete = !nextCursor && (Boolean(cursor) ||
      (expectedTotal !== undefined && result.length >= expectedTotal))
    if (complete || (targetPersonId && personIds.has(targetPersonId))) {
      return finish(complete, page + 1)
    }
    if (nextCursor) { seenCursors.add(nextCursor); cursor = nextCursor }
    else offset += items.length
  }
  runtime.logger.event('pending_read', 'failed', { pendingCount: result.length, page: 20,
    errorCode: 'pending_invitations_truncated' })
  throw connectionError('unipile_pending_invitations_truncated',
    'Pending invitations exceeded the safe read-back pagination limit.', { httpStatus: 503 })
}
