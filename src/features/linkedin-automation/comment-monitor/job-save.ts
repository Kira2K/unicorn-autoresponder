import { logged } from './logger.ts'
import type { CommentLogger, MonitorJob } from './types.ts'

export async function createJob(store: any, job: MonitorJob, logger: CommentLogger) {
  await logged(logger, 'noco_job_create', () => store.create(job), { level: 'info' })
}

export async function saveJob(store: any, job: MonitorJob, logger: CommentLogger) {
  job.updatedAt = new Date().toISOString()
  try { await logged(logger, 'noco_job_update', () => store.update(job), { level: 'debug' }) }
  catch (cause) { throw Object.assign(new Error('Не удалось сохранить состояние комментариев.'),
    { code: 'comment_monitor_persistence_unavailable', cause }) }
}

export async function readJobs(store: any, logger: CommentLogger) {
  return logged(logger, 'noco_jobs_read', () => store.list(), { level: 'debug' })
}
