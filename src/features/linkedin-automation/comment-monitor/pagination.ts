import { nextCursor, pageItems } from './unipile-adapter.ts'
import type { CommentLogger } from './types.ts'

export async function allPages(
  load: (cursor?: string) => Promise<any>, logger: CommentLogger, stage: string, maxPages = 20
) {
  const items: any[] = []
  let cursor = ''
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await load(cursor || undefined)
    const batch = pageItems(response); items.push(...batch)
    logger.event(stage, 'succeeded', { level: 'debug', page, count: batch.length })
    const next = nextCursor(response)
    if (!next || next === cursor || !batch.length) break
    cursor = next
  }
  return items
}
