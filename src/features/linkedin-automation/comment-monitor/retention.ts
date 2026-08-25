import { logged } from './logger.ts'

export async function purgeCommentHistory(store: any, logger: any) {
  await logged(logger, 'noco_retention_cleanup', () => store.purge(
    new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()), { level: 'debug' })
}

export function startCommentRetention(store: any, loggerFor: (job: any) => any) {
  const timer = setInterval(() => void purgeCommentHistory(store,
    loggerFor({ jobId: 'comment-monitor-retention', platformAccountId: 0 })), 24 * 60 * 60_000)
  timer.unref?.()
  return timer
}
