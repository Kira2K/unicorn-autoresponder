import { object, PostError } from '../../features/linkedin-automation/post-writer/errors.ts'
import type { Account } from '../../features/linkedin-automation/post-writer/types.ts'
import { listReadError } from './read-retry.ts'
type Request = (method: 'GET', path: string) => Promise<unknown>
export async function reactionPresent(account: Account, postId: string, request: Request): Promise<boolean> {
  return (await reactionsPresent(account, postId, [account.verifiedProviderId], request)).includes(account.verifiedProviderId)
}

export async function reactionsPresent(account: Account, postId: string, actorIds: string[], request: Request): Promise<string[]> {
  const targets = new Set(actorIds), found = new Set<string>()
  if (!targets.size) return []
  const seen = new Set<string>(), cursors = new Set<string>()
  let expectedTotal: number | undefined, cursor: string | undefined
  for (let offset = 0, pageNumber = 0; pageNumber < 100; pageNumber++) {
    const query = new URLSearchParams({ ...(cursor ? { cursor } : { offset: String(offset) }), limit: '100' })
    const page = object(await request('GET', `/${encodeURIComponent(account.unipileAccountId)}/posts/` +
      `${encodeURIComponent(postId)}/reactions?${query}`))
    if (!Array.isArray(page.data)) throw new PostError('post_reactions_invalid')
    const next = page.next_cursor
    if (next != null && (typeof next !== 'string' || (next && !next.trim())))
      throw listReadError('post_reactions_incomplete', 'cursor_invalid', { page: pageNumber + 1, offset })
    if (next && (!page.data.length || cursors.has(String(next))))
      throw listReadError('post_reactions_incomplete', 'cursor_repeated', { page: pageNumber + 1, offset })
    if (expectedTotal !== undefined && page.total_count !== undefined && page.total_count !== expectedTotal)
      throw listReadError('post_reactions_incomplete', 'changed_total', { page: pageNumber + 1, offset, total: expectedTotal })
    if (page.total_count !== undefined && (!Number.isSafeInteger(page.total_count) || Number(page.total_count) < 0 ||
      offset + page.data.length > Number(page.total_count))) throw new PostError('post_reactions_incomplete')
    if (page.total_count !== undefined) expectedTotal = Number(page.total_count)
    if (!page.data.length) {
      if (expectedTotal !== undefined && offset < expectedTotal) throw new PostError('post_reactions_incomplete')
      return [...found]
    }
    for (const value of page.data) {
      const reaction = object(value)
      const sender = object(reaction.sender)
      if (typeof sender.id !== 'string' || !sender.id.trim()) throw new PostError('post_reactions_invalid')
      if (targets.has(sender.id)) found.add(sender.id)
      if (found.size === targets.size) return [...found]
      if (seen.has(sender.id)) throw new PostError('post_reactions_repeated')
      seen.add(sender.id)
    }
    offset += page.data.length
    if (!next && (typeof cursor === 'string' || (expectedTotal !== undefined && offset >= expectedTotal))) {
      if (expectedTotal !== undefined && offset !== expectedTotal) throw new PostError('post_reactions_incomplete')
      return [...found]
    }
    if (next && offset === expectedTotal) throw new PostError('post_reactions_incomplete')
    cursor = typeof next === 'string' && next ? next : undefined
    if (cursor) cursors.add(cursor)
  }
  throw new PostError('post_reactions_incomplete')
}
