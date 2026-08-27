import { randomUUID } from 'node:crypto'
import { allPages } from './pagination.ts'
import type { CommentLogger, MonitorItem, MonitorJob, TrackedPost } from './types.ts'

const idOf = (item: any) => String(item?.id ?? '').trim()
const dateOf = (item: any) => String(item?.created_at ?? '')
const textOf = (item: any) => String(item?.text ?? '').trim().slice(0, 2_000)

function outstanding(messages: any[]) {
  const ordered = [...messages].sort((a, b) => Date.parse(dateOf(a)) - Date.parse(dateOf(b)))
  return ordered.filter((item, index) => !item?.is_sender && idOf(item) &&
    !ordered.slice(index + 1).some(later => later?.is_sender))
}

function monitorItem(post: TrackedPost, item: any, thread: any[]): MonitorItem {
  const now = new Date().toISOString()
  return { incomingId: idOf(item), postId: post.id,
    threadId: String(item?.thread_id ?? thread[0]?.thread_id ?? idOf(thread[0]) ?? idOf(item)),
    parentId: idOf(item), incomingText: textOf(item),
    threadText: thread.slice(-10).map(textOf).filter(Boolean).join('\n').slice(0, 6_000),
    status: 'detected',
    createdAt: dateOf(item) || now, updatedAt: now }
}

export async function discoverComments(options: {
  job: MonitorJob; adapter: any; logger: CommentLogger
}) {
  const { job, adapter, logger } = options
  const found: MonitorItem[] = []
  for (const post of job.state.posts) {
    const comments = await allPages(cursor => adapter.listComments(job.accountId, post.id,
      logger, cursor), logger, 'comments_page')
    for (const comment of comments) {
      const replies = Number(comment?.reply_counter) > 0
        ? await allPages(cursor => adapter.listReplies(job.accountId, post.id, idOf(comment),
          logger, cursor), logger, 'replies_page') : []
      const thread = [comment, ...replies]
      const pending = outstanding(thread)
      const senderCount = thread.filter(item => item?.is_sender).length
      const answeredCount = thread.filter(item => !item?.is_sender && idOf(item) &&
        !pending.some(candidate => idOf(candidate) === idOf(item))).length
      if (senderCount) logger.event('comment_ignore', 'succeeded', { level: 'debug',
        reasonCode: 'comment_is_sender', count: senderCount })
      if (answeredCount) logger.event('comment_ignore', 'succeeded', { level: 'debug',
        reasonCode: 'comment_already_answered', count: answeredCount })
      for (const incoming of pending) {
        const incomingId = idOf(incoming)
        if (job.state.knownIds.includes(incomingId)) {
          logger.event('comment_deduplicate', 'succeeded', { level: 'debug', count: 1 }); continue
        }
        job.state.knownIds.push(incomingId); job.state.discovered += 1
        if (incoming?.can_reply === false || !textOf(incoming)) {
          const item = monitorItem(post, incoming, thread)
          item.status = 'ignored'; item.reasonCode = incoming?.can_reply === false
            ? 'comment_cannot_reply' : 'comment_text_empty'
          job.state.items.push(item)
          logger.event('comment_ignore', 'succeeded', { reasonCode: item.reasonCode }); continue
        }
        const item = monitorItem(post, incoming, thread); found.push(item)
        job.state.items.push(item)
        logger.event('comment_discover', 'succeeded', { operationId: randomUUID(), count: 1 })
      }
    }
  }
  job.state.items = job.state.items.slice(-100)
  job.state.knownIds = job.state.knownIds.slice(-1000)
  return found.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
