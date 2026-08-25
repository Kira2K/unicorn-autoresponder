import { allPages } from './pagination.ts'
import { commentError } from './errors.ts'
import { logged } from './logger.ts'
import type { CommentLogger, TrackedPost } from './types.ts'

export async function selectPosts(options: {
  platformAccountId: number; repository: any; adapter: any; logger: CommentLogger
}) {
  const { platformAccountId, repository, adapter, logger } = options
  const rows = await logged(logger, 'noco_account_read', () => repository.listAccounts(), {
    level: 'debug' })
  const row = rows.find((item: any) => Number(item.platformAccountId) === platformAccountId)
  if (!row) throw commentError('linkedin_account_not_found', 'LinkedIn account was not found.')
  if (!row.unipileAccountId || row.unipileAccountStatus !== 'running' || !row.lastVerifiedAt) {
    throw commentError('comment_monitor_auth_required', 'Verify or reconnect LinkedIn first.')
  }
  const account = await adapter.getAccount(row.unipileAccountId, logger)
  const userId = String(account?.user_id ?? row.verifiedProviderId ?? '').trim()
  if (!userId) throw commentError('comment_monitor_user_id_missing',
    'LinkedIn provider user ID is missing.')
  const posts: TrackedPost[] = await logged(logger, 'post_selection', async () => {
    const raw = await allPages(cursor => adapter.listPosts(row.unipileAccountId, userId,
      logger, cursor), logger, 'posts_page', 1)
    return raw.map((post: any) => ({ id: String(post?.id ?? '').trim(),
      url: String(post?.share_url ?? post?.url ?? '').trim() || undefined,
      createdAt: String(post?.created_at ?? '').trim() || undefined,
      text: String(post?.text ?? '').trim().slice(0, 5_000) })).filter((post: TrackedPost) => post.id)
      .sort((a: TrackedPost, b: TrackedPost) =>
        Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '')).slice(0, 2)
  })
  if (!posts.length) throw commentError('comment_monitor_posts_missing',
    'No LinkedIn posts were found for this account.')
  return { row, posts }
}
