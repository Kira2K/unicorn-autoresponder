import * as httpClientModule from '../../../integrations/unipile/http-client.ts'
import { randomUUID } from 'node:crypto'
import { createUnipileRequestScheduler } from '../../../integrations/unipile/request-scheduler.ts'
import { errorLogDetails } from './errors.ts'
import type { CommentLogger } from './types.ts'

const { createUnipileHttpClient } = httpClientModule as unknown as {
  createUnipileHttpClient(options?: any): any
}
const sharedScheduler = createUnipileRequestScheduler()

export function createCommentUnipileAdapter(options: {
  http?: any; scheduler?: any
} = {}) {
  const http = options.http ?? createUnipileHttpClient()
  const scheduler = options.scheduler ?? sharedScheduler
  async function request(logger: CommentLogger, operation: string, method: 'GET' | 'POST',
    path: string, body?: unknown) {
    const started = Date.now()
    const operationId = randomUUID()
    logger.event('unipile_request', 'started', { level: 'debug', operation, operationId, attempt: 1 })
    try {
      const result = await scheduler.run(() => http.request(method, path, body))
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
    listPosts: (accountId: string, userId: string, logger: CommentLogger, cursor?: string) => {
      const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
      return request(logger, 'posts_page_read', 'GET', `/${encodeURIComponent(accountId)}/users/` +
        `${encodeURIComponent(userId)}/posts?${query}`)
    },
    listComments: (accountId: string, postId: string, logger: CommentLogger, cursor?: string) => {
      const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
      return request(logger, 'comments_page_read', 'GET', `/${encodeURIComponent(accountId)}/posts/` +
        `${encodeURIComponent(postId)}/comments?${query}`)
    },
    listReplies: (accountId: string, postId: string, commentId: string,
      logger: CommentLogger, cursor?: string) => {
      const query = new URLSearchParams({ limit: '100' }); if (cursor) query.set('cursor', cursor)
      return request(logger, 'replies_page_read', 'GET', `/${encodeURIComponent(accountId)}/posts/` +
        `${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/replies?${query}`)
    },
    reply: (accountId: string, postId: string, commentId: string, text: string,
      logger: CommentLogger) => request(logger, 'comment_reply_write', 'POST',
      `/${encodeURIComponent(accountId)}/posts/${encodeURIComponent(postId)}/comments/` +
      `${encodeURIComponent(commentId)}`, { text })
  }
}

export function pageItems(value: any): any[] {
  return Array.isArray(value) ? value : value?.items ?? value?.data ?? []
}

export const nextCursor = (value: any) => String(value?.cursor ?? value?.next_cursor ?? '').trim()
