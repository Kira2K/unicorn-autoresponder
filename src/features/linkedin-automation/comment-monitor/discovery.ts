import { randomUUID } from 'node:crypto'
import { allPages } from './pagination.ts'
import type { CommentLogger, MonitorItem, MonitorJob, TrackedPost } from './types.ts'
import { recordFailure, recoveryExpired, skipRecovery, ACTION_SKIPPED } from '../action-recovery.ts'
import { commentError } from './errors.ts'

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
  job: MonitorJob; adapter: any; logger: CommentLogger; now?: () => number
}) {
  const { job, adapter, logger } = options
  const now = options.now ?? Date.now
  // Durable dedupe is separate from display retention, including legacy items.
  const known = new Set([...job.state.knownIds, ...job.state.items.map(item => item.incomingId)])
  job.state.knownIds = [...known]
  const checked = job.state.checkedThreads ??= {}
  const found: MonitorItem[] = []
  const recovery = job.state.readRecovery ??= {}
  const loadPage = <T>(load: () => Promise<T>) => {
    if (job.status === 'disabled') throw commentError('comment_monitor_disabled', 'Monitor is disabled.')
    return load()
  }
  const read = async <T>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (recoveryExpired(recovery[key], now())) {
      if (recovery[key].skippedAt === undefined) {
        skipRecovery(recovery[key], now())
        logger.event('action_skipped', 'failed', { reasonCode: ACTION_SKIPPED, actionId: key,
          message: 'Чтение этой ветки комментариев пропущено после 20 минут ошибок сервиса.' })
      }
      return undefined
    }
    try { const result = await action(); delete recovery[key]; return result }
    catch (error) {
      const value = recordFailure(recovery[key], error, now())
      if (value) recovery[key] = value
      throw error
    }
  }
  for (const post of job.state.posts) {
    const comments = await read(`post:${post.id}`, () => allPages(cursor => loadPage(() => adapter.listComments(job.accountId, post.id,
      logger, cursor)), logger, 'comments_page'))
    if (!comments) continue
    for (const comment of comments) {
      const key = JSON.stringify([post.id, idOf(comment)])
      const count = Number(comment?.reply_counter), cached = checked[key]
      // Only settled threads can be skipped. Changed counts/text and the hourly
      // refresh still discover new replies, including delete/add with equal counts.
      if (cached && Number.isSafeInteger(count) && cached.count === count && cached.text === textOf(comment) &&
        now() >= cached.at && now() - cached.at < 60 * 60_000) {
        logger.event('replies_cache', 'succeeded', { reasonCode: 'settled_thread_unchanged', count: 1 })
        continue
      }
      delete checked[key]
      const replies = Number(comment?.reply_counter) > 0
        ? await read(key, () => allPages(cursor => loadPage(() => adapter.listReplies(job.accountId, post.id, idOf(comment),
          logger, cursor)), logger, 'replies_page')) : []
      if (!replies) continue
      const thread = [comment, ...replies]
      const pending = outstanding(thread)
      if (!pending.length && Number.isSafeInteger(count) && count === replies.length)
        checked[key] = { count, text: textOf(comment), at: now() }
      const senderCount = thread.filter(item => item?.is_sender).length
      const answeredCount = thread.filter(item => !item?.is_sender && idOf(item) &&
        !pending.some(candidate => idOf(candidate) === idOf(item))).length
      if (senderCount) logger.event('comment_ignore', 'succeeded', { level: 'debug',
        reasonCode: 'comment_is_sender', count: senderCount })
      if (answeredCount) logger.event('comment_ignore', 'succeeded', { level: 'debug',
        reasonCode: 'comment_already_answered', count: answeredCount })
      for (const incoming of pending) {
        const incomingId = idOf(incoming)
        if (known.has(incomingId)) {
          logger.event('comment_deduplicate', 'succeeded', { level: 'debug', count: 1 }); continue
        }
        known.add(incomingId); job.state.knownIds.push(incomingId); job.state.discovered += 1
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
  // Unknown writes remain durable even when later comments fill the display history.
  job.state.items = [...job.state.items.filter(item => ['publishing', 'uncertain'].includes(item.status)),
    ...job.state.items.filter(item => !['publishing', 'uncertain'].includes(item.status)).slice(-100)]
  job.state.checkedThreads = Object.fromEntries(Object.entries(checked)
    .filter(([, value]) => now() - value.at < 60 * 60_000).slice(-1000))
  return found.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}
