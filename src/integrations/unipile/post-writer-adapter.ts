import { PostError, object } from '../../features/linkedin-automation/post-writer/errors.ts'
import type { Account, Log, PostAdapter, ProviderPost } from '../../features/linkedin-automation/post-writer/types.ts'
import { reactionPresent } from './post-writer-reactions.ts'
export type PostRequestScheduler = { run<T>(operation: () => Promise<T>): Promise<T> }
export type PostHttp = { request<T>(method: 'GET' | 'POST', path: string, body?: unknown,
  options?: { fullRetryAfter: boolean; noCache: boolean }): Promise<T> }
export function parsePost(value: unknown): ProviderPost {
  const post = object(value)
  const author = object(post.author)
  if (typeof post.id !== 'string' || typeof post.text !== 'string' || typeof author.id !== 'string' ||
    typeof post.share_url !== 'string' || !/^https:\/\/(www\.)?linkedin\.com\//.test(post.share_url) ||
    !Number.isFinite(Date.parse(String(post.created_at)))) throw new PostError('post_response_invalid')
  if (post.attachments !== undefined && !Array.isArray(post.attachments)) throw new PostError('post_response_invalid')
  const images = (post.attachments ?? []).map(object).filter(item => item.type === 'img').map(item => {
    if (typeof item.id !== 'string' || !item.id || typeof item.mimetype !== 'string' ||
      !item.mimetype.startsWith('image/')) throw new PostError('post_response_invalid')
    return { id: item.id, available: item.is_unavailable !== true }
  })
  return { id: post.id, text: post.text, authorId: author.id, url: post.share_url,
    createdAt: Date.parse(String(post.created_at)), images }
}
export function createPostAdapter(log: Log, client: PostHttp,
  scheduler: PostRequestScheduler): PostAdapter {
  const request = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const start = Date.now()
    log('unipile_request_started', { method, operation: path.includes('reactions') ? 'reaction' : 'post' })
    try { return await scheduler.run(() => client.request(method, path, body,
      { fullRetryAfter: true, noCache: method === 'GET' })) }
    finally { log('unipile_request_finished', { method, durationMs: Date.now() - start }) }
  }
  const path = (account: Account) => `/${encodeURIComponent(account.unipileAccountId)}`
  return {
    async identity(account) {
      const current = object(await request('GET', `/accounts/${encodeURIComponent(account.unipileAccountId)}`))
      if (current.provider !== 'LINKEDIN' && current.provider !== 'linkedin') throw new PostError('post_identity_mismatch')
      if (current.status !== 'running' || current.is_locked) throw new PostError('post_account_not_ready')
      const own = object(await request('GET', `${path(account)}/users/me?variant=linkedin_classic`))
      if (own.id !== account.verifiedProviderId) throw new PostError('post_identity_mismatch')
    },
    async publish(account, text, image) { return parsePost(await request('POST', `${path(account)}/posts`,
      { text, can_read: 'anyone', can_comment: 'anyone', ...(image ? { attachments: [image] } : {}) })) },
    async read(account, id) { return parsePost(await request('GET', `${path(account)}/posts/${encodeURIComponent(id)}`)) },
    async recent(account) {
      const result: ProviderPost[] = []
      const cursors = new Set<string>()
      let cursor = ''
      let pages = 0
      do {
        pages++
        const query = new URLSearchParams({ limit: '100', ...(cursor ? { cursor } : {}) })
        const page = object(await request('GET', `${path(account)}/users/${encodeURIComponent(account.verifiedProviderId)}/posts?${query}`))
        if (!Array.isArray(page.data)) throw new PostError('post_page_invalid')
        result.push(...page.data.map(parsePost))
        cursor = String(page.next_cursor ?? '')
        if (cursor && cursors.has(cursor)) throw new PostError('post_cursor_repeated')
        cursors.add(cursor)
        // Reconciliation is bounded. An unobserved post remains uncertain, never absent-for-retry.
      } while (cursor && pages < 3)
      return result
    },
    reacted: (account, id) => reactionPresent(account, id, request),
    async like(account, id) {
      const response = object(await request('POST', `${path(account)}/posts/${encodeURIComponent(id)}/reactions`,
        { reaction: 'linkedin_like' }))
      if (response.object !== 'PostReactionAdded') throw new PostError('post_reaction_unconfirmed')
    }
  }
}
