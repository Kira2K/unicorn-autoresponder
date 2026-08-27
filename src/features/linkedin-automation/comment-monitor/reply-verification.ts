import { allPages } from './pagination.ts'
import { randomBetween } from './schedule.ts'
import type { CommentLogger, MonitorItem, MonitorJob } from './types.ts'

const textOf = (value: any) => String(value?.text ?? '').trim()

async function readReplies(options: any, item: MonitorItem) {
  return allPages(cursor => options.adapter.listReplies(options.job.accountId, item.postId,
    item.parentId, options.logger, cursor), options.logger, 'reply_verify_page')
}

export async function readVerified(options: any, item: MonitorItem, replyId?: string) {
  const rows = await readReplies(options, item)
  return rows.find((row: any) => row?.is_sender &&
    (replyId ? String(row.id) === replyId : textOf(row) === item.replyText))
}

export async function verifyWithRetry(options: any, item: MonitorItem, replyId?: string) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) {
      const delayMs = randomBetween(2_000, 5_000, options.random)
      options.logger.event('reply_verify_delay', 'started', { attempt, delayMs })
      await options.sleep(delayMs)
      options.logger.event('reply_verify_delay', 'succeeded', { attempt, delayMs })
    }
    options.logger.event('reply_readback', 'started', { attempt })
    const match = await readVerified(options, item, replyId)
    options.logger.event('reply_readback', match ? 'succeeded' : 'failed', { attempt,
      level: match ? 'debug' : 'warn', reasonCode: match ? undefined : 'comment_reply_not_visible' })
    if (match) return match
  }
}

export function markVerified(job: MonitorJob, item: MonitorItem, row: any, logger: CommentLogger) {
  item.replyId = String(row?.id ?? item.replyId ?? '') || undefined
  item.status = 'verified'; item.updatedAt = new Date().toISOString()
  job.state.published += 1
  job.state.threadReplies[item.threadId] = (job.state.threadReplies[item.threadId] ?? 0) + 1
  logger.event('reply_verified', 'succeeded', { publishedCount: job.state.published })
}

export async function reconcileUncertain(options: {
  job: MonitorJob; adapter: any; logger: CommentLogger; save: () => Promise<void>
}) {
  for (const item of options.job.state.items.filter(row => row.status === 'uncertain')) {
    options.logger.event('reply_reconcile', 'started')
    const match = await readVerified(options, item, item.replyId)
    if (match) {
      markVerified(options.job, item, match, options.logger)
      options.logger.event('reply_reconcile', 'succeeded')
    }
    else {
      item.status = 'failed'; item.reasonCode = 'comment_reply_not_verified'
      item.updatedAt = new Date().toISOString(); options.job.state.failed += 1
      options.logger.event('reply_reconcile', 'failed', { errorCode: 'comment_reply_not_verified' })
    }
    await options.save()
  }
}
