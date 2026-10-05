import { allPages } from './pagination.ts'
import { commentErrorCode } from './errors.ts'
import type { CommentLogger, MonitorItem, MonitorJob } from './types.ts'
import { recordFailure, recoveryExpired, recoveryWakeAt, skipRecovery, ACTION_SKIPPED } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { withRequestContext } = (requestControl as any).default ?? requestControl

const textOf = (value: any) => String(value?.text ?? '').trim()

async function readReplies(options: any, item: MonitorItem, replyId?: string) {
  return withRequestContext({ actionId: `reply:${item.incomingId}` }, () => allPages(cursor => options.adapter.listReplies(options.job.accountId, item.postId,
    item.parentId, options.logger, cursor, true), options.logger, 'reply_verification_page', 20,
    rows => Boolean(replyId && rows.some(row => row?.is_sender && row.id === replyId))))
}

export async function readVerified(options: any, item: MonitorItem, replyId?: string) {
  const id = item.replyId || replyId
  const rows = await readReplies(options, item, id)
  if (id) return rows.find((row: any) => row?.is_sender && String(row.id) === id)
  const attempted = Date.parse(item.attemptedAt ?? '')
  if (!Number.isFinite(attempted)) return undefined
  const matches = new Map(rows.filter((row: any) => row?.id && row?.is_sender &&
    textOf(row) === String(item.replyText ?? '').trim() &&
    Date.parse(row.created_at ?? '') >= attempted &&
    Date.parse(row.created_at ?? '') <= (options.now?.() ?? Date.now()))
    .map((row: any) => [String(row.id), row]))
  return matches.size === 1 ? [...matches.values()][0] : undefined
}

export async function verifyWithRetry(options: any, item: MonitorItem, replyId?: string) {
  // Eventual consistency is handled by the durable verification schedule, not rapid full scans.
  options.logger.event('reply_readback', 'started', { attempt: 1 })
  const match = await readVerified(options, item, replyId)
  options.logger.event('reply_readback', match ? 'succeeded' : 'failed', { attempt: 1,
    level: match ? 'debug' : 'warn', reasonCode: match ? undefined : 'comment_reply_not_visible' })
  return match
}

export function markVerified(job: MonitorJob, item: MonitorItem, row: any, logger: CommentLogger) {
  if (item.status === 'verified') return
  item.replyId = String(row?.id ?? item.replyId ?? '') || undefined
  item.status = 'verified'; item.updatedAt = new Date().toISOString()
  item.nextVerificationAt = undefined; item.reasonCode = undefined
  item.recovery = undefined
  job.state.published += 1
  job.state.threadReplies[item.threadId] = (job.state.threadReplies[item.threadId] ?? 0) + 1
  logger.event('reply_verified', 'succeeded', { publishedCount: job.state.published })
}

export const pendingReplies = (job: MonitorJob) => job.state.items.filter(item =>
  item.status === 'uncertain' || item.status === 'publishing')

export const activePendingReplies = (job: MonitorJob) => pendingReplies(job).filter(item => item.recovery?.skippedAt === undefined)

export function expireReplyRecovery(job: MonitorJob, now: number, logger: CommentLogger) {
  let changed = false
  for (const item of job.state.items.filter(item => item.recovery?.skippedAt === undefined &&
    ['detected', 'generating', 'queued', 'publishing', 'uncertain'].includes(item.status))) if (recoveryExpired(item.recovery, now)) {
    skipRecovery(item.recovery!, now); item.reasonCode = ACTION_SKIPPED; item.nextVerificationAt = undefined
    item.status = item.attemptedAt ? 'uncertain' : 'failed'; changed = true
    if (!item.attemptedAt) job.state.failed += 1
    logger.event('action_skipped', 'failed', { reasonCode: ACTION_SKIPPED, incomingId: item.incomingId,
      message: item.attemptedAt ? 'Ответ не подтверждён за 20 минут после ошибки сервиса. Переходим к остальным; повторной отправки не будет.' :
        'Ответ не подготовлен за 20 минут после ошибки сервиса. Переходим к остальным комментариям.' })
  }
  return changed
}

export const nextVerificationAt = (job: MonitorJob) => activePendingReplies(job)
  .map(item => item.nextVerificationAt ?? new Date(0).toISOString()).sort()[0]

export function scheduleVerification(item: MonitorItem, now: number, error?: any) {
  item.recovery = recordFailure(item.recovery, error, now)
  item.status = 'uncertain'; item.uncertainSince ??= item.attemptedAt ?? new Date(now).toISOString()
  const elapsed = now - Date.parse(item.uncertainSince)
  const checks = item.verificationChecks ?? 0
  const delay = elapsed < 10 * 60_000 ? 60_000 :
    [15, 30, 60][Math.min(2, checks)] * 60_000
  if (elapsed >= 10 * 60_000) item.verificationChecks = checks + 1
  const retryAt = Number(error?.details?.retryAt)
  const providerAt = Number.isFinite(retryAt) ? retryAt : now + (Number(error?.details?.retryAfterMs) || 0)
  item.nextVerificationAt = new Date(recoveryWakeAt(item.recovery, Math.max(now + delay, providerAt))).toISOString()
  item.reasonCode = error ? commentErrorCode(error) : 'comment_reply_not_visible'
  item.updatedAt = new Date(now).toISOString()
}

export async function reconcileUncertain(options: {
  job: MonitorJob; adapter: any; logger: CommentLogger; save: () => Promise<void>; now?: () => number
}) {
  if (expireReplyRecovery(options.job, options.now?.() ?? Date.now(), options.logger)) await options.save()
  for (const item of activePendingReplies(options.job)) {
    if (Date.parse(item.nextVerificationAt ?? '') > (options.now?.() ?? Date.now())) continue
    // Flush a possibly failed ID save before reading or allowing any new write.
    item.status = 'uncertain'; await options.save()
    options.logger.event('reply_reconcile', 'started')
    let match: any, error: any
    try { match = await readVerified(options, item) } catch (caught) { error = caught }
    if (match) {
      markVerified(options.job, item, match, options.logger)
      options.logger.event('reply_reconcile', 'succeeded')
    }
    else {
      scheduleVerification(item, options.now?.() ?? Date.now(), error)
      options.logger.event('reply_reconcile', 'failed', { errorCode: item.reasonCode,
        nextActionAt: item.nextVerificationAt })
    }
    await options.save()
    if (error) {
      for (const pending of activePendingReplies(options.job)) {
        if (!pending.nextVerificationAt || pending.nextVerificationAt < item.nextVerificationAt!)
          pending.nextVerificationAt = new Date(recoveryWakeAt(pending.recovery, Date.parse(item.nextVerificationAt!))).toISOString()
      }
      await options.save(); return error
    }
  }
}
