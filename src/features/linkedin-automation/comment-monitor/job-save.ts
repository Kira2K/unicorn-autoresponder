import { logged } from './logger.ts'
import type { CommentLogger, MonitorJob } from './types.ts'

export async function createJob(store: any, job: MonitorJob, logger: CommentLogger) {
  await logged(logger, 'noco_job_create', () => store.create(job), { level: 'info' })
}

export async function saveJob(store: any, job: MonitorJob, logger: CommentLogger) {
  job.updatedAt = new Date().toISOString()
  await logged(logger, 'noco_job_update', () => store.update(job), { level: 'debug' })
}

export async function readJobs(store: any, logger: CommentLogger) {
  return logged(logger, 'noco_jobs_read', () => store.list(), { level: 'debug' })
}
