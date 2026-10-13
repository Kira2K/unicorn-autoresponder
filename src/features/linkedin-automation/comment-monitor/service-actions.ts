import { logged } from './logger.ts'
import { activeStatus, publicMonitorJob, type MonitorJob } from './types.ts'
import { clearAuthorContext } from './author-context.ts'
import { pendingReplies } from './reply-verification.ts'

export function createServiceActions(options: any) {
  const { assertReady, jobs, loggerFor, run, save, store } = options as {
    assertReady(): Promise<void>; jobs: Map<string, MonitorJob>; loggerFor(job: any): any
    run(job: MonitorJob): Promise<void>; save(job: MonitorJob, logger?: any): Promise<void>; store: any
  }
  return {
    async disable(platformAccountId: number) {
      await assertReady(); const audit = loggerFor({ jobId: `disable-${platformAccountId}`,
        platformAccountId }); audit.event('session_disable', 'started')
      const targets = [...jobs.values()].filter(row => row.platformAccountId === platformAccountId &&
        row.status !== 'disabled' && (activeStatus(row.status) || pendingReplies(row).length))
      if (!targets.length) { audit.event('session_disable', 'succeeded', { reasonCode: 'not_enabled' }); return }
      // Stop every executor in memory before the first asynchronous checkpoint.
      for (const job of targets) {
        job.status = 'disabled'; job.stage = 'disabled_by_admin'; job.nextCheckAt = undefined
        job.finishedAt = new Date().toISOString(); clearAuthorContext(job, loggerFor(job))
      }
      const results = await Promise.allSettled(targets.map(job => save(job, loggerFor(job))))
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      audit.event('session_disable', 'succeeded'); return publicMonitorJob(targets[0])
    },
    async resume(jobId: string) {
      await assertReady(); const audit = loggerFor({ jobId, platformAccountId: 0 })
      audit.event('session_resume', 'started')
      try {
        const job = jobs.get(jobId) ?? await logged(audit, 'noco_job_read', () => store.get(jobId), {
          level: 'debug' })
        if (!job) throw Object.assign(new Error('Monitor job not found.'),
          { code: 'comment_monitor_job_not_found' })
        if (job.status !== 'paused') throw Object.assign(new Error('Monitor is not paused.'),
          { code: 'comment_monitor_resume_invalid' })
        job.status = 'waiting'; job.stage = 'resumed'; job.errorCode = undefined
        job.nextCheckAt ??= new Date().toISOString(); await save(job, loggerFor(job)); void run(job)
        audit.event('session_resume', 'succeeded'); return publicMonitorJob(job)
      } catch (error) { audit.event('session_resume', 'failed', {
        errorCode: String((error as any)?.code ?? 'comment_monitor_internal_error') }); throw error }
    },
    async get(jobId: string) {
      await assertReady(); const audit = loggerFor({ jobId, platformAccountId: 0 })
      audit.event('admin_job_read', 'started', { level: 'debug' })
      const job = jobs.get(jobId) ?? await logged(audit, 'noco_job_read', () => store.get(jobId), {
        level: 'debug' })
      audit.event('admin_job_read', 'succeeded', { level: 'debug', count: job ? 1 : 0 })
      return job && publicMonitorJob(job)
    },
    async list() {
      await assertReady(); const audit = loggerFor({ jobId: 'comment-monitor-list',
        platformAccountId: 0 }); audit.event('admin_jobs_read', 'started', { level: 'debug' })
      const result = [...jobs.values()].sort((a, b) => Date.parse(b.createdAt) -
        Date.parse(a.createdAt)).map(publicMonitorJob)
      audit.event('admin_jobs_read', 'succeeded', { level: 'debug', count: result.length })
      return result
    }
  }
}
