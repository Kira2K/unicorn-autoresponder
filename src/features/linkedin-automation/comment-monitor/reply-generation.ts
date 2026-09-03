import { validateReply } from './reply-validation.ts'
import { deterministicSkipReason, validateModelDecision,
  type ReplyPolicyReason } from './reply-policy.ts'
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

type ReplyReservations = {
  existingTotal: number
  existingThreads: Record<string, number>
  total: number
  threads: Record<string, number>
}

type ReplyResolution = {
  action: 'reply'
  text: string
} | {
  action: 'skip'
  reason: ReplyPolicyReason
}

function replyReservations(job: MonitorJob): ReplyReservations {
  const pending = job.state.items.filter(item =>
    ['queued', 'publishing', 'uncertain'].includes(item.status))
  const existingThreads: Record<string, number> = {}
  for (const item of pending) {
    existingThreads[item.threadId] = (existingThreads[item.threadId] ?? 0) + 1
  }
  return { existingTotal: pending.length, existingThreads, total: 0, threads: {} }
}

function replyLimitReason(job: MonitorJob, item: MonitorItem, reserved: ReplyReservations,
  includeNew = true) {
  const newTotal = includeNew ? reserved.total : 0
  const newInThread = includeNew ? (reserved.threads[item.threadId] ?? 0) : 0
  return job.state.published + reserved.existingTotal + newTotal >= 30
    ? 'comment_session_limit_reached' : (job.state.threadReplies[item.threadId] ?? 0) +
      (reserved.existingThreads[item.threadId] ?? 0) + newInThread >= 7
      ? 'comment_thread_limit_reached' : ''
}

function clearReply(item: MonitorItem) {
  item.replyText = undefined; item.replyId = undefined
}

function markLimitIgnored(item: MonitorItem, reason: string, logger: CommentLogger) {
  clearReply(item)
  item.status = 'ignored'; item.reasonCode = reason; item.updatedAt = new Date().toISOString()
  logger.event('reply_limit_check', 'failed', { level: 'warn', reasonCode: reason })
}

function eligible(job: MonitorJob, item: MonitorItem, logger: CommentLogger,
  reserved: ReplyReservations) {
  const reason = replyLimitReason(job, item, reserved)
  if (!reason) {
    reserved.total += 1; reserved.threads[item.threadId] = (reserved.threads[item.threadId] ?? 0) + 1
    logger.event('reply_limit_check', 'succeeded', { level: 'debug', itemCount: 1 })
    return true
  }
  markLimitIgnored(item, reason, logger)
  return false
}

function markIgnored(item: MonitorItem, reason: ReplyPolicyReason, logger: CommentLogger) {
  clearReply(item)
  item.status = 'ignored'; item.reasonCode = reason; item.updatedAt = new Date().toISOString()
  logger.event('reply_policy', 'succeeded', { reasonCode: reason, itemCount: 1 })
}

function resolveOutputs(job: MonitorJob, items: MonitorItem[], output: any, logger: CommentLogger) {
  const replies = Array.isArray(output?.replies) ? output.replies : []
  const resolutions = new Map<MonitorItem, ReplyResolution>()
  const invalid: MonitorItem[] = []
  for (const item of items) {
    const result = replies.find((row: any) => String(row?.incoming_id) === item.incomingId)
    const policy = validateModelDecision(result, item.incomingText)
    if (!policy.ok || !policy.decision) {
      invalid.push(item)
      logger.event('reply_policy', 'failed', { level: 'warn',
        reasonCode: 'comment_reply_decision_invalid', itemCount: 1 })
      continue
    }
    if (policy.decision.action === 'skip') {
      resolutions.set(item, { action: 'skip', reason: policy.decision.reason })
      continue
    }
    const value = validateReply(result?.reply, result?.grounding_phrase,
      `${context(job, item).post}\n${item.incomingText}\n${item.threadText}`)
    logger.event('reply_validation', value.ok ? 'succeeded' : 'failed', {
      level: value.ok ? 'debug' : 'warn', reasonCode: value.issues[0], itemCount: 1 })
    if (!value.ok) { invalid.push(item); continue }
    resolutions.set(item, { action: 'reply', text: value.text })
  }
  return { resolutions, invalid }
}

function markFailed(job: MonitorJob, item: MonitorItem) {
  clearReply(item)
  item.status = 'failed'; item.reasonCode = 'comment_reply_validation_failed'
  item.updatedAt = new Date().toISOString(); job.state.failed += 1
}

function markDetected(item: MonitorItem) {
  clearReply(item)
  item.status = 'detected'; item.reasonCode = undefined; item.updatedAt = new Date().toISOString()
}

function queueReply(item: MonitorItem, text: string, logger: CommentLogger) {
  item.replyText = text; item.replyId = undefined; item.reasonCode = undefined
  item.status = 'queued'; item.updatedAt = new Date().toISOString()
  logger.event('reply_queue', 'succeeded', { itemCount: 1 })
}

export async function generateReplies(options: {
  job: MonitorJob; items: MonitorItem[]; openai: any; logger: CommentLogger
  loadAuthorContext?: () => Promise<AuthorContext>
}) {
  const { job, openai, logger } = options
  const reserved = replyReservations(job)
  const candidates = options.items.filter(item => {
    const reason = deterministicSkipReason(item.incomingText)
    if (reason) { markIgnored(item, reason, logger); return false }
    const limitReason = replyLimitReason(job, item, reserved, false)
    if (limitReason) { markLimitIgnored(item, limitReason, logger); return false }
    return true
  })
  const queued: MonitorItem[] = []
  const authorContext = candidates.length && options.loadAuthorContext
    ? await options.loadAuthorContext() : {}
  for (const batch of batches(candidates, 5)) {
    batch.forEach(item => {
      clearReply(item); item.reasonCode = undefined
      item.status = 'generating'; item.updatedAt = new Date().toISOString()
    })
    try {
      logger.event('author_context_attach', 'started', { operation: 'initial',
        count: Object.keys(authorContext).length })
      const initialInput = { author_context: authorContext,
        items: batch.map(item => context(job, item)) }
      logger.event('author_context_attach', 'succeeded', { operation: 'initial',
        count: Object.keys(authorContext).length })
      const initial = resolveOutputs(job, batch, await openai.generate(initialInput, logger), logger)
      const resolutions = initial.resolutions
      let invalid = initial.invalid
      if (invalid.length) {
        logger.event('reply_repair', 'started', { attempt: 1, itemCount: invalid.length })
        logger.event('author_context_attach', 'started', { operation: 'repair',
          count: Object.keys(authorContext).length })
        const repairInput = { repair: true, author_context: authorContext,
          items: invalid.map(item => context(job, item)) }
        logger.event('author_context_attach', 'succeeded', { operation: 'repair',
          count: Object.keys(authorContext).length })
        const repaired = resolveOutputs(job, invalid,
          await openai.generate(repairInput, logger), logger)
        for (const [item, resolution] of repaired.resolutions) {
          resolutions.set(item, resolution)
        }
        invalid = repaired.invalid
        logger.event('reply_repair', invalid.length ? 'failed' : 'succeeded', {
          attempt: 1, itemCount: invalid.length })
      }
      const invalidItems = new Set(invalid)
      for (const item of batch) {
        if (invalidItems.has(item)) { markFailed(job, item); continue }
        const resolution = resolutions.get(item)
        if (!resolution) { markFailed(job, item); continue }
        if (resolution.action === 'skip') {
          markIgnored(item, resolution.reason, logger); continue
        }
        if (!eligible(job, item, logger, reserved)) continue
        queueReply(item, resolution.text, logger)
      }
      queued.push(...batch.filter(item => item.status === 'queued'))
    } catch (error) {
      batch.forEach(markDetected)
      throw error
    }
  }
  return queued
}
