import { readJobs } from './job-save.ts'
import { purgeCommentHistory } from './retention.ts'
import { activeStatus, type MonitorJob } from './types.ts'
import { clearAuthorContext } from './author-context.ts'
import { activePendingReplies, nextVerificationAt } from './reply-verification.ts'
import { nextMonitorActionAt } from './schedule.ts'

export async function restoreMonitorJobs(options: {
  store: any; jobs: Map<string, MonitorJob>; loggerFor: (job: any) => any
  save: (job: MonitorJob, logger?: any) => Promise<void>
  now?: () => number
}) {
  const logger = options.loggerFor({ jobId: 'comment-monitor-restore', platformAccountId: 0 })
  logger.event('session_restore', 'started')
  const stored: MonitorJob[] = await readJobs(options.store, logger)
  for (const job of stored) {
    options.jobs.set(job.jobId, job)
    for (const item of job.state.items) if (item.status === 'publishing') {
      item.status = 'uncertain'; item.reasonCode = 'comment_reply_uncertain'
      // Legacy intent has no reliable POST timestamp: do not invent text confirmation evidence.
      item.uncertainSince ??= item.attemptedAt ?? item.updatedAt
    }
    if (activePendingReplies(job).length) {
      if (activeStatus(job.status)) { job.status = 'paused'; job.stage = 'reply_outcome_uncertain' }
      job.nextCheckAt = nextMonitorActionAt(job, nextVerificationAt(job), options.now?.() ?? Date.now())
      await options.save(job, options.loggerFor(job)); continue
    }
    if (!activeStatus(job.status)) {
      if (job.authorContextStatus || job.authorHeadline || job.authorAbout) {
        const jobLogger = options.loggerFor(job); clearAuthorContext(job, jobLogger)
        await options.save(job, jobLogger)
      }
      continue
    }
    if ((options.now?.() ?? Date.now()) >= Date.parse(job.expiresAt)) {
      job.status = 'completed'; job.stage = 'expired'; job.finishedAt = new Date().toISOString()
      const jobLogger = options.loggerFor(job); clearAuthorContext(job, jobLogger)
      await options.save(job, jobLogger)
    } else if (job.status !== 'paused') {
      job.status = 'waiting'; job.stage = 'restored'
      job.nextCheckAt ??= new Date(options.now?.() ?? Date.now()).toISOString()
      await options.save(job, options.loggerFor(job))
    }
  }
  await purgeCommentHistory(options.store, logger).catch(() => undefined)
  logger.event('session_restore', 'succeeded', { count: stored.length })
}
