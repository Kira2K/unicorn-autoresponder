import { replyDelay } from './schedule.ts'
import { commentError, commentErrorCode } from './errors.ts'
import { markVerified, readVerified, verifyWithRetry } from './reply-verification.ts'
import { clearAuthorContext } from './author-context.ts'
import type { CommentLogger, MonitorItem, MonitorJob } from './types.ts'

const sleepDefault = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function publishReplies(options: {
  job: MonitorJob; items: MonitorItem[]; adapter: any; logger: CommentLogger
  save: () => Promise<void>; sleep?: (milliseconds: number) => Promise<void>; random?: () => number
}) {
  const { job, logger } = options
  const sleep = options.sleep ?? sleepDefault
  let sent = 0
  for (const item of options.items) {
    if (item.status !== 'queued') continue
    if (!['checking', 'replying'].includes(job.status)) break
    if (sent) {
      const delayMs = replyDelay(options.random)
      logger.event('reply_delay', 'started', { delayMs }); await sleep(delayMs)
      logger.event('reply_delay', 'succeeded', { delayMs })
      if (!['checking', 'replying'].includes(job.status)) break
    }
    if (Date.now() >= Date.parse(job.expiresAt)) {
      job.status = 'completed'; job.stage = 'expired'; job.nextCheckAt = undefined
      job.finishedAt = new Date().toISOString(); clearAuthorContext(job, logger)
      await options.save(); break
    }
    item.status = 'publishing'; item.updatedAt = new Date().toISOString(); await options.save()
    logger.event('reply_publish', 'started', { publishedCount: job.state.published })
    try {
      const response = await options.adapter.reply(job.accountId, item.postId, item.parentId,
        item.replyText, logger)
      item.replyId = String(response?.id ?? '') || undefined
      const match = await verifyWithRetry({ ...options, sleep }, item, item.replyId)
      if (!match) throw commentError('comment_reply_uncertain', 'Reply was not verified.')
      markVerified(job, item, match, logger); sent += 1; await options.save()
      logger.event('reply_publish', 'succeeded', { publishedCount: job.state.published })
    } catch (error) {
      const code = commentErrorCode(error)
      if (['unipile_timeout', 'unipile_unreachable'].includes(code)) {
        const match = await readVerified(options, item).catch(() => undefined)
        if (match) { markVerified(job, item, match, logger); sent += 1; await options.save(); continue }
      }
      if (/too_many|rate_limit/.test(code)) { item.status = 'queued'; await options.save(); throw error }
      item.status = code === 'comment_reply_uncertain' || code === 'unipile_timeout' ||
        code === 'unipile_unreachable' ? 'uncertain' : 'failed'
      item.reasonCode = code; item.updatedAt = new Date().toISOString()
      if (item.status === 'failed') job.state.failed += 1
      await options.save(); logger.event('reply_publish', 'failed', { errorCode: code })
      if (item.status === 'uncertain') throw commentError('comment_reply_uncertain',
        'Reply result is uncertain.')
    }
  }
}
