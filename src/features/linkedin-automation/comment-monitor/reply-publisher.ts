import { replyDelay } from './schedule.ts'
import { commentError, commentErrorCode } from './errors.ts'
import { markVerified, scheduleVerification, verifyWithRetry, pendingReplies, expireReplyRecovery } from './reply-verification.ts'
import { recordFailure } from '../action-recovery.ts'
import { clearAuthorContext } from './author-context.ts'
import type { CommentLogger, MonitorItem, MonitorJob } from './types.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl

const sleepDefault = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export async function publishReplies(options: {
  job: MonitorJob; items: MonitorItem[]; adapter: any; logger: CommentLogger
  save: () => Promise<void>; sleep?: (milliseconds: number) => Promise<void>; random?: () => number
  now?: () => number
  isClosing?(): boolean
}) {
  const { job, logger } = options
  const sleep = options.sleep ?? sleepDefault
  const now = options.now ?? Date.now
  let sent = 0
  for (const item of options.items) {
    if (expireReplyRecovery(job, now(), logger)) await options.save()
    if (item.status !== 'queued') continue
    if (job.state.published + pendingReplies(job).length >= 30) break
    if (options.isClosing?.()) break
    if (!['checking', 'replying'].includes(job.status)) break
    if (sent) {
      const delayMs = replyDelay(options.random)
      logger.event('reply_delay', 'started', { delayMs }); await sleep(delayMs)
      logger.event('reply_delay', 'succeeded', { delayMs })
      if (!['checking', 'replying'].includes(job.status)) break
    }
    if (now() >= Date.parse(job.expiresAt)) {
      job.status = 'completed'; job.stage = 'expired'; job.nextCheckAt = undefined
      job.finishedAt = new Date().toISOString(); clearAuthorContext(job, logger)
      await options.save(); break
    }
    item.status = 'publishing'; item.attemptedAt = new Date(now()).toISOString()
    item.updatedAt = item.attemptedAt; await options.save()
    if (options.isClosing?.()) { item.status = 'queued'; item.attemptedAt = undefined; await options.save(); break }
    if (!['checking', 'replying'].includes(job.status) || now() >= Date.parse(job.expiresAt)) {
      item.status = 'ignored'; item.reasonCode = 'comment_monitor_disabled'
      item.attemptedAt = undefined; await options.save(); break
    }
    logger.event('reply_publish', 'started', { publishedCount: job.state.published })
    let sendError: any
    try {
      const response = await withRequestContext({ actionId: `reply:${item.incomingId}` }, () =>
        options.adapter.reply(job.accountId, item.postId, item.parentId, item.replyText, logger))
      item.replyId = String(response?.id ?? '') || undefined
    } catch (error: any) {
      const code = commentErrorCode(error)
      // Only a definitive rejection before provider execution permits another POST.
      if (error?.notSent === true || code === 'unipile_api_too_many_requests') {
        item.status = 'queued'; item.attemptedAt = undefined
        await options.save(); throw error
      }
      if ([400, 401, 403, 404, 422].includes(Number(error?.details?.httpStatus))) {
        item.status = 'failed'; item.reasonCode = code; job.state.failed += 1
        await options.save(); throw error
      }
      sendError = error
      item.recovery = recordFailure(item.recovery, error, now())
    }
    // A save failure escapes before verification; the durable intent forbids resending on restart.
    await options.save()
    let match: any, verificationError: any = sendError
    if (!sendError?.details?.retryAfterMs && !/too_many|rate_limit/.test(commentErrorCode(sendError))) {
      try { match = await verifyWithRetry({ ...options, sleep }, item) }
      catch (error) { verificationError = error }
    }
    if (match) {
      markVerified(job, item, match, logger); sent += 1; await options.save()
      logger.event('reply_publish', 'succeeded', { publishedCount: job.state.published })
      continue
    }
    scheduleVerification(item, now(), verificationError); await options.save()
    logger.event('reply_publish', 'failed', { errorCode: item.reasonCode,
      nextActionAt: item.nextVerificationAt })
    throw commentError('comment_reply_uncertain', 'Reply result is uncertain.', verificationError?.details)
  }
}
