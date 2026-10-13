import { createRequire } from 'node:module'
import type { FeedCard } from './home-feed.mts'
import type { FeedAction, FeedRunDependencies, PreparedPost } from '../../features/linkedin-automation/feed-reader/run.mts'
const { withRequestContext } = createRequire(import.meta.url)('./request-control.ts')
type Http = { request(method: 'GET' | 'POST', path: string, body?: unknown, options?: { noCache: boolean; fullRetryAfter: boolean }): Promise<any> }
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }) }
function samePost(actual: string, expected: string): boolean {
  if (actual === expected) return true
  // A V2 repost ID contains [repost, original]; GET can return [original].
  // Accept only this observed alias, never an arbitrary changed ID.
  const parts = (id: string): string[] => {
    try {
      if (id.length > 512 || Buffer.from(id, 'base64').toString('base64') !== id) return []
      const value = JSON.parse(Buffer.from(id, 'base64').toString('utf8'))
      return Array.isArray(value) && value.every(p => typeof p === 'string' && /^(activity|ugcPost):\d+$/.test(p)) ? value : []
    } catch { return [] }
  }
  const original = parts(expected), resolved = parts(actual)
  return original.length === 2 && resolved.length === 1 && original[1] === resolved[0]
}
function post(value: any): PreparedPost {
  if (value?.object !== 'Post' || typeof value.id !== 'string' || !value.id || typeof value.text !== 'string' ||
    typeof value.author?.id !== 'string' || !value.author.id ||
    ![true, false].includes(value.permissions?.can_react) || ![true, false].includes(value.permissions?.can_post_comments) ||
    !(typeof value.user_reacted === 'boolean' || typeof value.user_reacted === 'string' && value.user_reacted.length)) fail('feed_post_response_invalid')
  return { id: value.id, text: value.text, authorId: value.author.id, canReact: value.permissions.can_react,
    canComment: value.permissions.can_post_comments, reacted: value.user_reacted !== false }
}
/** Uses the installed Unipile request policy and account queue; never retries a POST. */
export function createFeedActions(input: { client: Http; accountId: string; signal?: AbortSignal; now(): number }): FeedRunDependencies['provider'] {
  if (!/^acc_[A-Za-z0-9_-]+$/.test(input.accountId)) fail('feed_account_invalid')
  const request = (method: 'GET' | 'POST', path: string, body?: unknown) => {
    input.signal?.throwIfAborted()
    return withRequestContext({ account: input.accountId, feature: 'feed', ...(input.signal ? { signal: input.signal } : {}) }, () =>
      input.client.request(method, `/${input.accountId}/posts/${path}`, body, { noCache: true, fullRetryAfter: true })) as Promise<any>
  }
  const path = (id: string) => { if (!id || typeof id !== 'string') fail('feed_post_id_invalid'); return encodeURIComponent(id) }
  const matches = (row: any, action: FeedAction) => row?.object === 'Comment' && row.is_sender === true &&
    typeof row.id === 'string' && row.text === action.text && (action.commentId ? row.id === action.commentId :
      Number.isFinite(Date.parse(row.created_at)) && Date.parse(row.created_at) >= Math.floor(action.attemptedAt! / 1000) * 1000 &&
      Date.parse(row.created_at) <= input.now())
  return {
    async prepare(card: FeedCard) {
      // V2 Retrieve Posts explicitly accepts activity:ID and ugcPost:ID ONLY on GET.
      // Use the returned canonical ID for all mutations, not the raw feed URN.
      if (!/^urn:li:(activity|ugcPost):\d+$/.test(card.id)) fail('feed_native_post_id_unsupported')
      return post(await request('GET', path(card.id.replace(/^urn:li:/, ''))))
    },
    async like(id) {
      const value = await request('POST', `${path(id)}/reactions`, { reaction: 'linkedin_like' })
      if (value?.object !== 'PostReactionAdded') fail('feed_like_response_invalid')
    },
    async comment(id, text) {
      const value = await request('POST', `${path(id)}/comments`, { text })
      if (value?.object !== 'Comment' || typeof value.id !== 'string' || !value.id || value.text !== text || value.is_sender !== true)
        fail('feed_comment_response_invalid')
      return { id: value.id }
    },
    async verify(action) {
      if (!action.postId) fail('feed_post_id_missing')
      if (action.kind === 'like') {
        const value = await request('GET', path(action.postId!))
        post(value) // Validate an actual Post, not an arbitrary truthy field.
        // V2 returns "like" on reads; the provider-prefixed type belongs to writes.
        return samePost(value.id, action.postId!) && (value.user_reacted === 'like' || value.user_reacted === 'linkedin_like' || value.user_reacted === true)
      }
      // There is no GET-comment-by-ID in V2. Read this post's comments only.
      const ids = new Set<string>(), found: string[] = []
      let offset = 0, expectedTotal: number | undefined
      for (let page = 0; page < 3; page++) {
        const value = await request('GET', `${path(action.postId!)}/comments?limit=100&offset=${offset}`)
        if (!Array.isArray(value?.data)) fail('feed_comments_response_invalid')
        const total = value.total_count
        if (total !== undefined && total !== null && (!Number.isSafeInteger(total) || total < 0 ||
          expectedTotal !== undefined && total !== expectedTotal)) fail('feed_comments_total_changed')
        if (Number.isSafeInteger(total)) expectedTotal = total
        let fresh = 0
        for (const row of value.data) {
          if (typeof row?.id !== 'string' || !row.id) fail('feed_comments_response_invalid')
          if (!ids.has(row.id)) { fresh++; ids.add(row.id); if (matches(row, action)) found.push(row.id) }
        }
        if (action.commentId && found.includes(action.commentId)) return true
        offset += value.data.length
        // A known ID needs only a positive match. Text matching without an ID needs
        // a complete stable list; an arbitrary short page is not proof of completeness.
        const complete = expectedTotal !== undefined && ids.size === expectedTotal && offset === expectedTotal
        if (complete) return found.length === 1
        if (expectedTotal === undefined && !action.commentId) return false
        if (!fresh) return false
      }
      return false // Incomplete or ambiguous search is not confirmation and never permits a resend.
    }
  }
}
