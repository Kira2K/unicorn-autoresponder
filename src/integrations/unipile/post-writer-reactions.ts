import { object, PostError } from '../../features/linkedin-automation/post-writer/errors.ts'
import type { Account } from '../../features/linkedin-automation/post-writer/types.ts'
type Request = (method: 'GET', path: string) => Promise<unknown>
export async function reactionPresent(account: Account, postId: string, request: Request): Promise<boolean> {
  const seen = new Set<string>()
  for (let offset = 0, pageNumber = 0; pageNumber < 100; pageNumber++) {
    const query = new URLSearchParams({ offset: String(offset), limit: '100' })
    const page = object(await request('GET', `/${encodeURIComponent(account.unipileAccountId)}/posts/` +
      `${encodeURIComponent(postId)}/reactions?${query}`))
    if (!Array.isArray(page.data)) throw new PostError('post_reactions_invalid')
    if (!page.data.length) {
      if (typeof page.total_count === 'number' && offset < page.total_count) throw new PostError('post_reactions_incomplete')
      return false
    }
    for (const value of page.data) {
      const reaction = object(value)
      const sender = object(reaction.sender)
      if (typeof sender.id !== 'string') throw new PostError('post_reactions_invalid')
      if (sender.id === account.verifiedProviderId) return true
      if (seen.has(sender.id)) throw new PostError('post_reactions_repeated')
      seen.add(sender.id)
    }
    offset += page.data.length
    if (typeof page.total_count === 'number' && offset >= page.total_count) return false
  }
  throw new PostError('post_reactions_incomplete')
}
