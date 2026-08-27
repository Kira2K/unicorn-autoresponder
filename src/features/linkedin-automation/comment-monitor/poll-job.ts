import { randomUUID } from 'node:crypto'
import { discoverComments } from './discovery.ts'
import { commentErrorCode, errorLogDetails } from './errors.ts'
import { saveJob } from './job-save.ts'
import { nextCheckAt, randomBetween } from './schedule.ts'
import { generateReplies } from './reply-generation.ts'
import { publishReplies } from './reply-publisher.ts'
import { reconcileUncertain } from './reply-verification.ts'
import { clearAuthorContext, resolveAuthorContext } from './author-context.ts'
import type { CommentLogger, MonitorJob } from './types.ts'
function retryAt(error: any, random = Math.random) {
  const supplied = Number(error?.details?.retryAfterMs)
  const delay = Number.isFinite(supplied) ? supplied : randomBetween(5 * 60_000, 10 * 60_000, random)
  return new Date(Date.now() + delay).toISOString()
}

function transient(error: any, code: string) {
  const status = Number(error?.details?.httpStatus)
  return /too_many|rate_limit|timeout|unreachable|service_unavailable/.test(code) || status >= 500
}

export async function pollMonitorJob(options: {
  job: MonitorJob; store: any; adapter: any; openai: any; gate?: any; logger: CommentLogger
  random?: () => number; sleep?: (milliseconds: number) => Promise<void>
}) {
  const { job, logger } = options
  let release: undefined | (() => void)
  if (Date.now() >= Date.parse(job.expiresAt)) {
    job.status = 'completed'; job.stage = 'expired'; job.finishedAt = new Date().toISOString()
    clearAuthorContext(job, logger)
    await saveJob(options.store, job, logger); logger.event('session_expire', 'succeeded'); return
  }
  try {
    const operationId = randomUUID()
    logger.event('operation_gate', 'started', { operationId })
    release = options.gate?.acquire('comment_monitor', job.jobId,
      String(job.platformAccountId)) ?? (() => undefined)
    logger.event('operation_gate', 'succeeded', { operationId })
    job.status = 'checking'; job.stage = 'reading_comments'; job.errorCode = undefined
    await saveJob(options.store, job, logger)
    await reconcileUncertain({ job, adapter: options.adapter, logger,
      save: () => saveJob(options.store, job, logger) })
    const discovered = await discoverComments({ job, adapter: options.adapter, logger })
    const detected = job.state.items.filter(item => item.status === 'detected')
    await saveJob(options.store, job, logger)
    const generated = await generateReplies({ job, items: detected, openai: options.openai, logger,
      loadAuthorContext: () => resolveAuthorContext({ job, adapter: options.adapter, logger,
        save: () => saveJob(options.store, job, logger) }) })
    await saveJob(options.store, job, logger)
    const queued = job.state.items.filter(item => item.status === 'queued')
    job.status = queued.length ? 'replying' : 'checking'; job.stage = queued.length
      ? 'publishing_replies' : 'scheduling_next_check'
    await saveJob(options.store, job, logger)
    await publishReplies({ ...options, items: queued, save: () => saveJob(options.store, job, logger) })
    if (['disabled', 'completed'].includes(job.status as string)) return
    job.state.checks += 1; job.lastCheckAt = new Date().toISOString()
    if (job.state.published >= 30) {
      job.status = 'completed'; job.stage = 'limit_reached'; job.finishedAt = job.lastCheckAt
      job.nextCheckAt = undefined; clearAuthorContext(job, logger)
      logger.event('session_limit', 'succeeded', {
        publishedCount: job.state.published })
    } else {
      job.status = 'waiting'; job.stage = 'waiting_next_check'
      logger.event('schedule_next_check', 'started', { checkCount: job.state.checks })
      job.nextCheckAt = nextCheckAt(job.createdAt, Date.now(), options.random)
      logger.event('schedule_next_check', 'succeeded', { checkCount: job.state.checks,
        delayMs: job.nextCheckAt ? Date.parse(job.nextCheckAt) - Date.now() : 0 })
    }
    await saveJob(options.store, job, logger)
    logger.event('monitor_check', 'succeeded', { count: discovered.length,
      itemCount: generated.length, publishedCount: job.state.published })
  } catch (error) {
    if ((job.status as string) === 'disabled') {
      logger.event('monitor_check', 'failed', { level: 'warn',
        reasonCode: 'comment_monitor_disabled' }); return
    }
    const code = commentErrorCode(error)
    if (code === 'linkedin_operation_active') {
      job.status = 'waiting'; job.stage = 'waiting_for_account';
      job.nextCheckAt = new Date(Date.now() + randomBetween(60_000, 180_000, options.random)).toISOString()
    } else if (code === 'comment_reply_uncertain') {
      job.status = 'paused'; job.stage = 'reply_outcome_uncertain'; job.nextCheckAt = undefined
    } else if (transient(error, code)) {
      job.status = 'waiting'; job.stage = 'temporary_provider_limit'; job.nextCheckAt = retryAt(error,
        options.random)
    } else {
      job.status = 'error'; job.stage = 'monitor_failed'; job.finishedAt = new Date().toISOString()
      job.nextCheckAt = undefined; clearAuthorContext(job, logger)
    }
    job.errorCode = code
    await saveJob(options.store, job, logger).catch(() => undefined)
    logger.event('monitor_check', 'failed', { ...errorLogDetails(error), level: transient(error, code)
      ? 'warn' : 'error' })
  } finally {
    if (release) {
      logger.event('operation_release', 'started'); release()
      logger.event('operation_release', 'succeeded')
    }
  }
}
