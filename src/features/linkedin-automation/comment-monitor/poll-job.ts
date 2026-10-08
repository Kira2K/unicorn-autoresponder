import { SESSION_REPLY_LIMIT } from './reply-policy.ts'
import { randomUUID } from 'node:crypto'
import { discoverComments } from './discovery.ts'
import { commentErrorCode, errorLogDetails, commentExecutionInterrupted } from './errors.ts'
import { saveJob } from './job-save.ts'
import { nextCheckAt, randomBetween, replyDelay, nextMonitorActionAt } from './schedule.ts'
import { generateReplies } from './reply-generation.ts'
import { publishReplies } from './reply-publisher.ts'
import { reconcileUncertain, pendingReplies, sessionPendingReplies, releaseHistoricalQuota, nextQuotaReleaseAt,
  activePendingReplies, expireReplyRecovery, nextVerificationAt } from './reply-verification.ts'
import { clearAuthorContext, resolveAuthorContext } from './author-context.ts'
import type { CommentLogger, MonitorJob } from './types.ts'
import { providerRetryAt } from '../../../integrations/unipile/retry-after.ts'
import type { ExecutionStep } from '../execution-step.ts'
import { listReadDiagnostic } from '../../../integrations/unipile/read-retry.ts'
import { summaryMessage, recoveryExpired, skipRecovery, ACTION_SKIPPED, skippedActions, recoveryDeadline } from '../action-recovery.ts'
import * as requestControl from '../../../integrations/unipile/request-control.ts'
const { requestContext } = (requestControl as any).default ?? requestControl
function retryAt(error: any, random = Math.random, now = Date.now()) {
  const supplied = Number(error?.details?.retryAfterMs)
  const limited = error?.details?.httpStatus === 429 || /too_many|rate_limit|cooldown/.test(commentErrorCode(error))
  const delay = Number.isFinite(supplied) ? supplied : limited ? 5 * 60_000 : randomBetween(5 * 60_000, 10 * 60_000, random)
  return new Date(providerRetryAt(error, now, delay)).toISOString()
}

function transient(error: any, code: string) {
  const status = Number(error?.details?.httpStatus)
  return Boolean(listReadDiagnostic(error)) || /too_many|rate_limit|cooldown|timeout|unreachable|service_unavailable/.test(code) || status === 429 || status >= 500 ||
    Number(error?.details?.retryAt) > 0 || Number(error?.details?.retryAfterMs) > 0
}

export async function pollMonitorJob(options: Parameters<typeof pollMonitorStep>[0]): Promise<ExecutionStep> {
  const result = await monitorResult(options)
  return { ...result, ...monitorRecovery(options.job) }
}
export function monitorRecovery(job: MonitorJob) {
  const actions = { ...job.state.readRecovery,
    ...Object.fromEntries(job.state.items.filter(item => item.recovery).map(item => [`reply:${item.incomingId}`, item.recovery!])) }
  return { skippedActions: skippedActions(actions), recoveryDeadlineAt: recoveryDeadline(actions) }
}
async function monitorResult(options: Parameters<typeof pollMonitorStep>[0]): Promise<ExecutionStep> {
  if (options.job.status === 'disabled') return { status: 'stopped' }
  await pollMonitorStep(options)
  const job = options.job, nextActionAt = job.nextCheckAt
  if (activePendingReplies(job).length) return { status: 'verifying', nextActionAt, reason: job.errorCode }
  if (job.status === 'error') return { status: 'needs_attention', reason: job.errorCode }
  if (job.status === 'disabled') return { status: 'stopped' }
  if (job.status === 'completed') {
    const summary = { completed: job.state.published, skipped: job.state.failed +
      Object.values(job.state.readRecovery ?? {}).filter(value => value.skippedAt !== undefined).length,
      unconfirmed: pendingReplies(job).length }
    options.logger.event('session_summary', 'succeeded', { message: summaryMessage(summary) })
    return { status: 'completed', summary }
  }
  if (['paused', 'error'].includes(job.status)) return { status: 'needs_attention', reason: job.errorCode }
  return { status: nextActionAt ? 'waiting' : 'ready', nextActionAt }
}

async function pollMonitorStep(options: {
  job: MonitorJob; store: any; adapter: any; openai: any; gate?: any; logger: CommentLogger
  random?: () => number; sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  isClosing?(): boolean
  cooperate?<T>(action: () => Promise<T>): Promise<T>
}) {
  const { job, logger } = options
  if (job.status === 'disabled') return
  const now = options.now ?? Date.now
  if (expireReplyRecovery(job, now(), logger)) await saveJob(options.store, job, logger)
  for (const [actionId, value] of Object.entries(job.state.readRecovery ?? {})) {
    if (value.skippedAt !== undefined || !recoveryExpired(value, now())) continue
    skipRecovery(value, now())
    await saveJob(options.store, job, logger)
    logger.event('action_skipped', 'failed', { reasonCode: ACTION_SKIPPED, actionId })
  }
  const schedule = () => {
    job.nextCheckAt = nextMonitorActionAt(job, nextVerificationAt(job), now())
  }
  const canSend = () => !requestContext()?.signal?.aborted && !options.isClosing?.() && !['disabled', 'completed', 'error'].includes(job.status) &&
    now() < Date.parse(job.expiresAt)
  if (releaseHistoricalQuota(job, now())) await saveJob(options.store, job, logger)
  let release: undefined | (() => void)
  if (now() >= Date.parse(job.expiresAt)) {
    job.status = 'completed'; job.stage = 'expired'; job.finishedAt = new Date().toISOString()
    clearAuthorContext(job, logger)
    await saveJob(options.store, job, logger); logger.event('session_expire', 'succeeded')
  }
  if (!canSend() && !activePendingReplies(job).length) return
  if (Date.parse(job.state.providerNotBefore ?? '') > now()) {
    job.nextCheckAt = job.state.providerNotBefore; return
  }
  try {
    const operationId = randomUUID()
    logger.event('operation_gate', 'started', { operationId })
    release = options.gate?.acquire('comment_monitor', job.jobId,
      String(job.platformAccountId)) ?? (() => undefined)
    logger.event('operation_gate', 'succeeded', { operationId })
    const verificationError = await reconcileUncertain({ job, adapter: options.adapter, logger,
      now, save: () => saveJob(options.store, job, logger) })
    if (verificationError) throw verificationError
    if (activePendingReplies(job).length && (!canSend() || job.state.published + sessionPendingReplies(job).length >= SESSION_REPLY_LIMIT)) {
      if (canSend()) { job.status = 'paused'; job.stage = 'reply_outcome_uncertain' }
      job.nextCheckAt = nextVerificationAt(job); await saveJob(options.store, job, logger); return
    }
    if (!canSend()) return
    if (Date.parse(job.state.nextWorkAt ?? '') > now()) {
      schedule(); await saveJob(options.store, job, logger); return
    }
    if (job.state.published + sessionPendingReplies(job).length >= SESSION_REPLY_LIMIT) {
      const quotaAt = job.state.published < SESSION_REPLY_LIMIT ? nextQuotaReleaseAt(job, now()) : undefined
      if (quotaAt) {
        job.status = 'waiting'; job.stage = 'waiting_previous_session_quota'
        job.nextCheckAt = quotaAt; job.state.nextWorkAt = quotaAt
        await saveJob(options.store, job, logger); return
      }
      job.status = 'completed'; job.stage = 'limit_reached'; job.nextCheckAt = undefined
      clearAuthorContext(job, logger); await saveJob(options.store, job, logger); return
    }
    job.status = 'checking'; job.stage = 'reading_comments'; job.errorCode = undefined
    await saveJob(options.store, job, logger)
    const continuingQueue = job.state.items.some(item => item.status === 'queued')
    let discovered: unknown[] = [], generated: unknown[] = []
    if (!continuingQueue) {
      discovered = await discoverComments({ job, adapter: options.adapter, logger, now: options.now })
      const detected = job.state.items.filter(item => item.status === 'detected')
      await saveJob(options.store, job, logger)
      // Text generation does not mutate LinkedIn; other features may use the account.
      release?.(); release = undefined
      const generate = () => generateReplies({ job, items: detected, openai: options.openai, logger, now, canContinue: canSend,
        loadAuthorContext: () => resolveAuthorContext({ job, adapter: options.adapter, logger, now,
          save: () => saveJob(options.store, job, logger) }) })
      generated = options.cooperate ? await options.cooperate(generate) : await generate()
      job.state.checks += 1
      await saveJob(options.store, job, logger)
    }
    const queued = job.state.items.filter(item => item.status === 'queued')
    if (!canSend()) return
    release ??= options.gate?.acquire('comment_monitor', job.jobId, String(job.platformAccountId)) ?? (() => undefined)
    job.status = queued.length ? 'replying' : 'checking'; job.stage = queued.length
      ? 'publishing_replies' : 'scheduling_next_check'
    await saveJob(options.store, job, logger)
    await publishReplies({ ...options, items: queued.slice(0, 1), save: () => saveJob(options.store, job, logger) })
    if (['disabled', 'completed'].includes(job.status as string)) return
    job.lastCheckAt = new Date(now()).toISOString()
    if (job.state.published >= SESSION_REPLY_LIMIT) {
      job.status = 'completed'; job.stage = 'limit_reached'; job.finishedAt = job.lastCheckAt
      job.nextCheckAt = undefined; clearAuthorContext(job, logger)
      logger.event('session_limit', 'succeeded', {
        publishedCount: job.state.published })
    } else if (job.state.items.some(item => item.status === 'queued')) {
      job.status = 'waiting'; job.stage = 'waiting_reply_delay'
      job.nextCheckAt = new Date(now() + replyDelay(options.random)).toISOString()
    } else {
      job.status = 'waiting'; job.stage = 'waiting_next_check'
      logger.event('schedule_next_check', 'started', { checkCount: job.state.checks })
      job.nextCheckAt = nextCheckAt(job.createdAt, now(), options.random)
      logger.event('schedule_next_check', 'succeeded', { checkCount: job.state.checks,
        delayMs: job.nextCheckAt ? Date.parse(job.nextCheckAt) - Date.now() : 0 })
    }
    job.state.nextWorkAt = job.nextCheckAt; schedule()
    await saveJob(options.store, job, logger)
    logger.event('monitor_check', 'succeeded', { count: discovered.length,
      itemCount: generated.length, publishedCount: job.state.published })
  } catch (error) {
    if (commentExecutionInterrupted(error)) throw error
    if (['disabled', 'completed'].includes(job.status as string)) {
      if (pendingReplies(job).length) {
        if (transient(error, commentErrorCode(error))) job.state.providerNotBefore = retryAt(error, options.random, now())
        job.errorCode = commentErrorCode(error); schedule()
        await saveJob(options.store, job, logger)
      }
      logger.event('monitor_check', 'failed', { level: 'warn',
        reasonCode: commentErrorCode(error) }); return
    }
    const code = commentErrorCode(error)
    if (code === 'linkedin_operation_active') {
      job.status = 'waiting'; job.stage = 'waiting_for_account';
      job.nextCheckAt = new Date(now() + randomBetween(60_000, 180_000, options.random)).toISOString()
    } else if (transient(error, code)) {
      job.status = 'waiting'; job.stage = 'temporary_provider_limit'; job.nextCheckAt = retryAt(error,
        options.random, now())
      job.state.providerNotBefore = job.nextCheckAt
    } else if (code === 'comment_reply_uncertain' && pendingReplies(job).length) {
      job.status = 'waiting'; job.stage = 'reply_outcome_uncertain'
      job.nextCheckAt = new Date(now() + replyDelay(options.random)).toISOString()
    } else {
      job.status = 'error'; job.stage = 'monitor_failed'; job.finishedAt = new Date().toISOString()
      job.nextCheckAt = undefined; clearAuthorContext(job, logger)
    }
    job.state.nextWorkAt = job.nextCheckAt; schedule()
    job.errorCode = code
    await saveJob(options.store, job, logger)
    logger.event('monitor_check', 'failed', { ...errorLogDetails(error), level: transient(error, code)
      ? 'warn' : 'error' })
  } finally {
    if (release) {
      logger.event('operation_release', 'started'); release()
      logger.event('operation_release', 'succeeded')
    }
  }
}
