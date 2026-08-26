import { validateReply } from './reply-validation.ts'
import type { AuthorContext } from './author-context.ts'
import type { CommentLogger, MonitorItem, MonitorJob } from './types.ts'

const batches = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size))

function context(job: MonitorJob, item: MonitorItem) {
  return { incoming_id: item.incomingId,
    post: job.state.posts.find(post => post.id === item.postId)?.text ?? '',
    incoming_comment: item.incomingText, thread: item.threadText }
}

function pendingInThread(job: MonitorJob, threadId: string) {
  return job.state.items.filter(item => item.threadId === threadId &&
    ['queued', 'publishing', 'uncertain'].includes(item.status)).length
}

function eligible(job: MonitorJob, item: MonitorItem, logger: CommentLogger,
  reserved: { total: number; threads: Record<string, number> }) {
  const totalPending = job.state.items.filter(row =>
    ['queued', 'publishing', 'uncertain'].includes(row.status)).length
  const reason = job.state.published + totalPending + reserved.total >= 30
    ? 'comment_session_limit_reached' : (job.state.threadReplies[item.threadId] ?? 0) +
      pendingInThread(job, item.threadId) + (reserved.threads[item.threadId] ?? 0) >= 7
      ? 'comment_thread_limit_reached' : ''
  if (!reason) {
    reserved.total += 1; reserved.threads[item.threadId] = (reserved.threads[item.threadId] ?? 0) + 1
    logger.event('reply_limit_check', 'succeeded', { level: 'debug', itemCount: 1 })
    return true
  }
  item.status = 'ignored'; item.reasonCode = reason; item.updatedAt = new Date().toISOString()
  logger.event('reply_limit_check', 'failed', { level: 'warn', reasonCode: reason })
  return false
}

function applyOutputs(job: MonitorJob, items: MonitorItem[], output: any, logger: CommentLogger) {
  const replies = Array.isArray(output?.replies) ? output.replies : []
  const invalid: MonitorItem[] = []
  for (const item of items) {
    const result = replies.find((row: any) => String(row?.incoming_id) === item.incomingId)
    const value = validateReply(result?.reply, result?.grounding_phrase,
      `${context(job, item).post}\n${item.incomingText}\n${item.threadText}`)
    logger.event('reply_validation', value.ok ? 'succeeded' : 'failed', {
      level: value.ok ? 'debug' : 'warn', reasonCode: value.issues[0], itemCount: 1 })
    if (!value.ok) { invalid.push(item); continue }
    item.replyText = value.text; item.status = 'queued'; item.updatedAt = new Date().toISOString()
    logger.event('reply_queue', 'succeeded', { itemCount: 1 })
  }
  return invalid
}

export async function generateReplies(options: {
  job: MonitorJob; items: MonitorItem[]; openai: any; logger: CommentLogger
  loadAuthorContext?: () => Promise<AuthorContext>
}) {
  const { job, openai, logger } = options
  const reserved = { total: 0, threads: {} as Record<string, number> }
  const candidates = options.items.filter(item => eligible(job, item, logger, reserved))
  const queued: MonitorItem[] = []
  const authorContext = candidates.length && options.loadAuthorContext
    ? await options.loadAuthorContext() : {}
  for (const batch of batches(candidates, 5)) {
    batch.forEach(item => { item.status = 'generating'; item.updatedAt = new Date().toISOString() })
    try {
      logger.event('author_context_attach', 'started', { operation: 'initial',
        count: Object.keys(authorContext).length })
      const initialInput = { author_context: authorContext,
        items: batch.map(item => context(job, item)) }
      logger.event('author_context_attach', 'succeeded', { operation: 'initial',
        count: Object.keys(authorContext).length })
      let invalid = applyOutputs(job, batch, await openai.generate(initialInput, logger), logger)
      if (invalid.length) {
        logger.event('reply_repair', 'started', { attempt: 1, itemCount: invalid.length })
        logger.event('author_context_attach', 'started', { operation: 'repair',
          count: Object.keys(authorContext).length })
        const repairInput = { repair: true, author_context: authorContext,
          items: invalid.map(item => context(job, item)) }
        logger.event('author_context_attach', 'succeeded', { operation: 'repair',
          count: Object.keys(authorContext).length })
        invalid = applyOutputs(job, invalid, await openai.generate(repairInput, logger), logger)
        logger.event('reply_repair', invalid.length ? 'failed' : 'succeeded', {
          attempt: 1, itemCount: invalid.length })
      }
      for (const item of invalid) {
        item.status = 'failed'; item.reasonCode = 'comment_reply_validation_failed'
        item.updatedAt = new Date().toISOString(); job.state.failed += 1
      }
      queued.push(...batch.filter(item => item.status === 'queued'))
    } catch (error) {
      batch.forEach(item => { item.status = 'detected'; item.updatedAt = new Date().toISOString() })
      throw error
    }
  }
  return queued
}
