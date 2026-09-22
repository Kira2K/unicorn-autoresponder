import { connectionError } from './errors.ts'
import type { ConnectionRuntime } from './runtime.ts'
import { parseConnectionPendingResponse, pendingPersonId } from './unipile-adapter.ts'

export async function readPendingInvitations(runtime: ConnectionRuntime, accountId: string,
  targetPersonId?: string) {
  const result: any[] = []; let offset = 0; let cursor: string | undefined
  let expectedTotal: number | undefined
  const seenCursors = new Set<string>(); const seenPeople = new Set<string>()
  for (let page = 0; page < 20; page += 1) {
    const response = await runtime.adapter().listPendingInvitations(accountId, cursor ?? offset)
    const { items, nextCursor, totalCount, hasMore } = parseConnectionPendingResponse(response)
    if (totalCount !== undefined) {
      if (expectedTotal !== undefined && totalCount !== expectedTotal) {
        throw connectionError('unipile_pending_pagination_invalid',
          'Pending invitations returned conflicting page totals.', { httpStatus: 503 })
      }
      expectedTotal = totalCount
    }
    if (hasMore === true && !nextCursor) {
      throw connectionError('unipile_pending_pagination_invalid',
        'Pending invitations response declares another page without a cursor.', { httpStatus: 503 })
    }
    if (nextCursor && (!items.length || nextCursor === cursor || seenCursors.has(nextCursor))) {
      throw connectionError('unipile_pending_pagination_invalid',
        'Pending invitations returned an unsafe cursor chain.', { httpStatus: 503 })
    }
    const pageIds = items.map(pendingPersonId)
    if (pageIds.some(personId => seenPeople.has(personId))) {
      throw connectionError('unipile_pending_pagination_invalid',
        'Pending invitations repeated a previous page item.', { httpStatus: 503 })
    }
    if (!items.length) {
      if (expectedTotal !== undefined && result.length < expectedTotal) {
        throw connectionError('unipile_pending_pagination_invalid',
          'Pending invitations ended before the declared total.', { httpStatus: 503 })
      }
      runtime.logger.event('pending_read', 'succeeded', { pendingCount: result.length, page: page + 1 })
      return { items: result, complete: true }
    }
    for (const personId of pageIds) seenPeople.add(personId)
    result.push(...items)
    if (expectedTotal !== undefined && result.length > expectedTotal) {
      throw connectionError('unipile_pending_pagination_invalid',
        'Pending invitations exceeded the declared total.', { httpStatus: 503 })
    }
    // A positive match is sufficient proof. Absence still requires every page.
    // No ordering (including newest-first) is assumed.
    if (targetPersonId && seenPeople.has(targetPersonId)) {
      const complete = !nextCursor && (expectedTotal === undefined ? hasMore === false : expectedTotal === result.length)
      runtime.logger.event('pending_target_read', 'succeeded', {
        pendingCount: result.length, page: page + 1, snapshotFresh: complete })
      return { items: result, complete }
    }
    if (hasMore === false && !nextCursor &&
      (expectedTotal === undefined || expectedTotal === result.length)) {
      runtime.logger.event('pending_read', 'succeeded', { pendingCount: result.length, page: page + 1 })
      return { items: result, complete: true }
    }
    if (nextCursor) {
      seenCursors.add(nextCursor); cursor = nextCursor
      continue
    }
    if (cursor && expectedTotal !== undefined && result.length < expectedTotal) {
      throw connectionError('unipile_pending_pagination_invalid',
        'Pending invitations cursor chain ended before the declared total.', { httpStatus: 503 })
    }
    if (cursor || (expectedTotal !== undefined && result.length >= expectedTotal)) {
      runtime.logger.event('pending_read', 'succeeded', { pendingCount: result.length, page: page + 1 })
      return { items: result, complete: true }
    }
    offset += items.length
  }
  runtime.logger.event('pending_read', 'failed', { pendingCount: result.length, page: 20,
    errorCode: 'pending_invitations_truncated' })
  throw connectionError('unipile_pending_invitations_truncated',
    'Pending invitations exceeded the safe read-back pagination limit.', { httpStatus: 503 })
}


export async function listAllPending(runtime: ConnectionRuntime, accountId: string) {
  return (await readPendingInvitations(runtime, accountId)).items
}
