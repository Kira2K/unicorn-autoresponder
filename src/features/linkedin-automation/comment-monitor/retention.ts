import { logged } from './logger.ts'
import path from 'node:path'
import { purgeDetailedLogs } from '../log-retention.ts'

export async function purgeCommentHistory(_store: any, logger: any,
  directory = path.resolve(process.cwd(), 'logs/linkedin-comments'), now = Date.now()) {
  await logged(logger, 'log_retention_cleanup', () => purgeDetailedLogs(directory, now), { level: 'debug' })
}

export function startCommentRetention(store: any, loggerFor: (job: any) => any) {
  const timer = setInterval(() => void purgeCommentHistory(store,
    loggerFor({ jobId: 'comment-monitor-retention', platformAccountId: 0 })).catch(() => undefined), 24 * 60 * 60_000)
  timer.unref?.()
  return timer
}
