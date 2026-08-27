import { errorLogDetails } from './errors.ts'
import { activeStatus, type CommentLogger, type MonitorJob } from './types.ts'

const READY_TTL_MS = 24 * 60 * 60_000
const NEGATIVE_TTL_MS = 30 * 60_000

export type AuthorContext = { headline?: string; about?: string }

const clean = (value: unknown, limit: number) => String(value ?? '').trim().slice(0, limit)
const fieldCount = (job: MonitorJob) => Number(Boolean(job.authorHeadline)) +
  Number(Boolean(job.authorAbout))

function useContext(job: MonitorJob, logger: CommentLogger): AuthorContext {
  const value = { ...(job.authorHeadline ? { headline: job.authorHeadline } : {}),
    ...(job.authorAbout ? { about: job.authorAbout } : {}) }
  logger.event('author_context_use', 'started', { count: Object.keys(value).length })
  logger.event('author_context_use', 'succeeded', { count: Object.keys(value).length,
    reasonCode: Object.keys(value).length === 2 ? 'full_context' :
      Object.keys(value).length === 1 ? 'partial_context' : 'empty_context' })
  return value
}

async function persist(save: () => Promise<void>, logger: CommentLogger) {
  logger.event('author_context_persist', 'started')
  try { await save(); logger.event('author_context_persist', 'succeeded') }
  catch (error) { logger.event('author_context_persist', 'failed', errorLogDetails(error)) }
}

export async function resolveAuthorContext(options: {
  job: MonitorJob; adapter: any; logger: CommentLogger; save: () => Promise<void>
  now?: () => number
}): Promise<AuthorContext> {
  const { job, logger } = options
  const now = options.now?.() ?? Date.now()
  const fetchedAt = Date.parse(job.authorContextFetchedAt ?? '')
  const age = Number.isFinite(fetchedAt) ? Math.max(0, now - fetchedAt) : Infinity
  const ready = job.authorContextStatus === 'ready' && fieldCount(job) > 0
  const ttl = ready ? READY_TTL_MS : NEGATIVE_TTL_MS
  logger.event('author_context_cache', 'started')
  if (age < ttl && job.authorContextStatus) {
    logger.event('author_context_cache', 'succeeded', { count: fieldCount(job), reasonCode: ready
      ? 'cache_hit' : 'negative_cache_hit' })
    if (!ready) logger.event('author_context_fallback', 'succeeded', {
      reasonCode: 'cached_profile_unavailable' })
    return useContext(job, logger)
  }
  logger.event('author_context_cache', 'succeeded', { count: fieldCount(job), reasonCode:
    Number.isFinite(fetchedAt) ? 'cache_expired' : 'cache_miss' })
  logger.event('author_context_provider_read', 'started')
  try {
    const profile = await options.adapter.getOwnProfile(job.accountId, logger)
    logger.event('author_context_provider_read', 'succeeded')
    if (!activeStatus(job.status)) {
      clearAuthorContext(job, logger); return {}
    }
    logger.event('author_context_normalize', 'started')
    job.authorHeadline = clean(profile?.description, 220) || undefined
    job.authorAbout = clean(profile?.bio, 2_600) || undefined
    job.authorContextFetchedAt = new Date(now).toISOString()
    job.authorContextStatus = fieldCount(job) ? 'ready' : 'empty'
    logger.event('author_context_normalize', 'succeeded', { count: fieldCount(job) })
    if (job.authorContextStatus === 'empty') logger.event('author_context_fallback', 'succeeded', {
      reasonCode: 'profile_empty' })
  } catch (error) {
    if (!activeStatus(job.status)) {
      logger.event('author_context_provider_read', 'failed', errorLogDetails(error))
      clearAuthorContext(job, logger); return {}
    }
    job.authorHeadline = undefined; job.authorAbout = undefined
    job.authorContextFetchedAt = new Date(now).toISOString(); job.authorContextStatus = 'failed'
    logger.event('author_context_provider_read', 'failed', errorLogDetails(error))
    logger.event('author_context_fallback', 'succeeded', { reasonCode: 'profile_unavailable' })
  }
  await persist(options.save, logger)
  return useContext(job, logger)
}

export function clearAuthorContext(job: MonitorJob, logger: CommentLogger) {
  logger.event('author_context_clear', 'started', { count: fieldCount(job) })
  job.authorHeadline = undefined; job.authorAbout = undefined
  job.authorContextFetchedAt = undefined; job.authorContextStatus = undefined
  logger.event('author_context_clear', 'succeeded', { count: 0 })
}
