import { nextCursor, pageItems } from './unipile-adapter.ts'
import type { CommentLogger } from './types.ts'
import { listReadError } from '../../../integrations/unipile/read-retry.ts'

export async function allPages(
  load: (cursor?: string | number) => Promise<any>, logger: CommentLogger, stage: string, maxPages = 20,
  stopWhen?: (items: any[]) => boolean
) {
  const items: any[] = []
  const cursors = new Set<string>(), ids = new Set<string>()
  let expectedTotal: number | undefined
  let cursor: string | number | undefined
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await load(cursor || undefined)
    const invalid = (reason: Parameters<typeof listReadError>[1], item?: number): never => {
      throw listReadError('comment_monitor_list_invalid', reason, { page, item, total: expectedTotal, observed: items.length })
    }
    const batch = pageItems(response)
    const next = nextCursor(response)
    if (response?.total_count !== undefined) {
      if (!Number.isSafeInteger(response.total_count) || response.total_count < 0) invalid('invalid_total')
      if (expectedTotal !== undefined && expectedTotal !== response.total_count) invalid('changed_total')
      expectedTotal = response.total_count
    }
    if (next && (!batch.length || cursors.has(next))) invalid('cursor_repeated')
    for (const [index, item] of batch.entries()) {
      if (typeof item?.id !== 'string' || !item.id.trim()) invalid('invalid_id', index + 1)
      if (ids.has(item.id)) invalid('duplicate_item', index + 1)
      ids.add(item.id)
    }
    items.push(...batch)
    if (expectedTotal !== undefined && (items.length > expectedTotal || (!batch.length && items.length < expectedTotal))) invalid('incomplete')
    logger.event(stage, 'succeeded', { level: 'debug', page, count: batch.length })
    if (stopWhen?.(items)) return items
    if (!next && (expectedTotal === undefined || items.length === expectedTotal)) return items
    if (!next && typeof cursor === 'string') invalid('incomplete')
    if (next) cursors.add(next)
    cursor = next || items.length
  }
  throw listReadError('comment_monitor_list_invalid', 'page_limit', { page: maxPages, observed: items.length })
}
