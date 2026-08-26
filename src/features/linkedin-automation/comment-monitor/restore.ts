import { readJobs } from './job-save.ts'
import { purgeCommentHistory } from './retention.ts'
import { activeStatus, type MonitorJob } from './types.ts'
import { clearAuthorContext } from './author-context.ts'

export async function restoreMonitorJobs(options: {
  store: any; jobs: Map<string, MonitorJob>; loggerFor: (job: any) => any
  save: (job: MonitorJob, logger?: any) => Promise<void>
}) {
  const logger = options.loggerFor({ jobId: 'comment-monitor-restore', platformAccountId: 0 })
  logger.event('session_restore', 'started')
  const stored: MonitorJob[] = await readJobs(options.store, logger)
  for (const job of stored) {
    options.jobs.set(job.jobId, job)
    if (!activeStatus(job.status)) {
      if (job.authorContextStatus || job.authorHeadline || job.authorAbout) {
        const jobLogger = options.loggerFor(job); clearAuthorContext(job, jobLogger)
        await options.save(job, jobLogger)
      }
      continue
    }
    if (job.state.items.some(item => item.status === 'publishing')) {
      job.state.items.filter(item => item.status === 'publishing').forEach(item => {
        item.status = 'uncertain'; item.reasonCode = 'comment_reply_uncertain'
      })
      job.status = 'paused'; job.stage = 'reply_outcome_uncertain'; job.nextCheckAt = undefined
      await options.save(job, options.loggerFor(job))
    } else if (Date.now() >= Date.parse(job.expiresAt)) {
      job.status = 'completed'; job.stage = 'expired'; job.finishedAt = new Date().toISOString()
      const jobLogger = options.loggerFor(job); clearAuthorContext(job, jobLogger)
      await options.save(job, jobLogger)
    } else if (job.status !== 'paused') {
      job.status = 'waiting'; job.stage = 'restored'; job.nextCheckAt = new Date().toISOString()
      await options.save(job, options.loggerFor(job))
    }
  }
  await purgeCommentHistory(options.store, logger)
  logger.event('session_restore', 'succeeded', { count: stored.length })
}
