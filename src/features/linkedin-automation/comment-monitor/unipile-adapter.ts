import * as httpClientModule from '../../../integrations/unipile/http-client.ts'
import { randomUUID } from 'node:crypto'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'
import { errorLogDetails } from './errors.ts'
import type { CommentLogger } from './types.ts'
import { listReadError } from '../../../integrations/unipile/read-retry.ts'

// CJS exports live under default when native Node reaches this file through require().
const { createUnipileHttpClient } = ((httpClientModule as { default?: unknown }).default ?? httpClientModule) as {
  createUnipileHttpClient(options?: any): any
}
const sharedScheduler = createUnipileRequestScheduler()

export function createCommentUnipileAdapter(options: {
  http?: any; scheduler?: any
} = {}) {
  const http = options.http ?? createUnipileHttpClient()
  const scheduler = options.scheduler ?? sharedScheduler
  async function request(logger: CommentLogger, operation: string, method: 'GET' | 'POST',
    path: string, body?: unknown, noCache = false) {
    const started = Date.now()
    const operationId = randomUUID()
    logger.event('unipile_request', 'started', { level: 'debug', operation, operationId, attempt: 1 })
    try {
      const result = await scheduler.run(() => http.request(method, path, body, { noCache }))
      logger.event('unipile_request', 'succeeded', { level: 'debug', operation, operationId, attempt: 1,
        durationMs: Date.now() - started, httpStatus: method === 'POST' ? 201 : 200 })
      return result
    } catch (error) {
      logger.event('unipile_request', 'failed', { level: 'warn', operation, operationId, attempt: 1,
        durationMs: Date.now() - started, ...errorLogDetails(error) })
      throw error
    }
  }
  return {
    getAccount: (accountId: string, logger: CommentLogger) => request(logger, 'account_read', 'GET',
      `/accounts/${encodeURIComponent(accountId)}`),
    getOwnProfile: (accountId: string, logger: CommentLogger) => request(logger,
      'own_profile_read', 'GET', `/${encodeURIComponent(accountId)}/users/me?` +
      new URLSearchParams({ variant: 'linkedin_classic' })),
    listPosts: (accountId: string, userId: string, logger: CommentLogger, cursor?: string | number) => {
      const query = pageQuery(cursor)
      return request(logger, 'posts_page_read', 'GET', `/${encodeURIComponent(accountId)}/users/` +
        `${encodeURIComponent(userId)}/posts?${query}`)
    },
    listComments: (accountId: string, postId: string, logger: CommentLogger, cursor?: string | number) => {
      const query = pageQuery(cursor)
      return request(logger, 'comments_page_read', 'GET', `/${encodeURIComponent(accountId)}/posts/` +
        `${encodeURIComponent(postId)}/comments?${query}`)
    },
    listReplies: (accountId: string, postId: string, commentId: string,
      logger: CommentLogger, cursor?: string | number, fresh = false) => {
      const query = pageQuery(cursor)
      return request(logger, 'replies_page_read', 'GET', `/${encodeURIComponent(accountId)}/posts/` +
        `${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/replies?${query}`, undefined, fresh)
    },
    reply: (accountId: string, postId: string, commentId: string, text: string,
      logger: CommentLogger) => request(logger, 'comment_reply_write', 'POST',
      `/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments/` +
      `${encodeURIComponent(commentId)}`, { text })
  }
}

function pageQuery(cursor?: string | number) {
  const query = new URLSearchParams({ limit: '100' })
  if (typeof cursor === 'number') query.set('offset', String(cursor))
  else if (cursor) query.set('cursor', cursor)
  return query
}

export function pageItems(value: any): any[] {
  const items = Array.isArray(value) ? value : value?.items ?? value?.data
  if (!Array.isArray(items)) throw listReadError('comment_monitor_list_invalid', 'missing_items')
  return items
}

export function nextCursor(value: any): string {
  const next = value?.next_cursor ?? value?.cursor ?? ''
  if (typeof next !== 'string' || (next && !next.trim()))
    throw listReadError('comment_monitor_list_invalid', 'cursor_invalid')
  return next
}
