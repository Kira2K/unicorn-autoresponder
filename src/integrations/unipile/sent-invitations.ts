import type { Invitation } from '../../features/linkedin-automation/invitation-withdrawal/contracts.ts'
import { listReadError } from './read-retry.ts'
type ReadPage = (offset: number, cursor?: string) => Promise<unknown>
// Only a complete snapshot may select withdrawals or prove that a request disappeared.
export async function readAllSentInvitations(readPage: ReadPage): Promise<Invitation[]> {
  const items = new Map<string, Invitation>(), cursors = new Set<string>()
  let expectedTotal: number | undefined, cursor: string | undefined, offset = 0
  for (let page = 1; page <= 100; page++) {
    const response = await readPage(offset, cursor) as any
    const invalid = (reason: Parameters<typeof listReadError>[1], item?: number): never => {
      throw listReadError('withdrawal_list_invalid', reason,
        { page, offset, item, total: expectedTotal, observed: items.size })
    }
    if (!response || !Array.isArray(response.data)) invalid('missing_items')
    if (response.total_count !== undefined) {
      if (!Number.isSafeInteger(response.total_count) || response.total_count < 0) invalid('invalid_total')
      if (expectedTotal !== undefined && expectedTotal !== response.total_count) invalid('changed_total')
      expectedTotal = response.total_count
    }
    const next = response.next_cursor
    if (next != null && typeof next !== 'string') invalid('cursor_invalid')
    if (next && (!next.trim() || !response.data.length)) invalid('cursor_invalid')
    if (next && cursors.has(next)) invalid('cursor_repeated')
    const before = items.size
    for (const [index, item] of response.data.entries()) {
      if (typeof item?.id !== 'string' || !item.id.trim()) invalid('invalid_id', index + 1)
      if (item.type !== 'sent') invalid('wrong_direction', index + 1)
      const prior = items.get(item.id)
      const createdAt = typeof item.created_at === 'string' ? item.created_at : undefined
      if (prior && prior.createdAt !== createdAt) invalid('conflicting_item', index + 1)
      items.set(item.id, { id: item.id, name: typeof item.user?.display_name === 'string' ? item.user.display_name : item.id,
        ...(createdAt !== undefined ? { createdAt } : {}) })
    }
    if (expectedTotal !== undefined && items.size > expectedTotal) invalid('invalid_total')
    const overlap = items.size - before < response.data.length
    // No declared total: duplicates may have displaced unseen rows. Never infer absence.
    if (overlap && (expectedTotal === undefined || before === items.size)) invalid('duplicate_item')
    if (!next && (items.size === expectedTotal || !response.data.length || cursor)) {
      if (expectedTotal !== undefined && items.size !== expectedTotal) invalid('incomplete')
      return [...items.values()]
    }
    if (next && items.size === expectedTotal) invalid('cursor_invalid')
    offset += response.data.length // Raw rows, not deduplicated size.
    cursor = next || undefined
    if (cursor) cursors.add(cursor)
  }
  throw listReadError('withdrawal_list_invalid', 'page_limit', { page: 100, offset, observed: items.size })
}
