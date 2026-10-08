import type { MonitorJob } from './types.ts'

const { SESSION_REPLY_LIMIT } = require('./reply-policy.ts') as typeof import('./reply-policy.ts')

const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
const { withRequestContext } = require('../../../integrations/unipile/request-control.ts')
const { createCommentLogger } = require('./logger.ts') as typeof import('./logger.ts')
const { createCommentMonitorStore } = require('./noco-store.ts') as {
  createCommentMonitorStore(client?: any): any
}
const { createCommentOpenAi } = require('./openai-client.ts') as typeof import('./openai-client.ts')
const { commentErrorCode, commentExecutionInterrupted } = require('./errors.ts') as typeof import('./errors.ts')
const { pollMonitorJob, monitorRecovery } = require('./poll-job.ts') as typeof import('./poll-job.ts')
const { selectPosts } = require('./post-selection.ts') as typeof import('./post-selection.ts')
const { SESSION_MS } = require('./schedule.ts') as typeof import('./schedule.ts')
const { createJob, saveJob } = require('./job-save.ts') as typeof import('./job-save.ts')
const { activeStatus, publicMonitorJob } = require('./types.ts') as typeof import('./types.ts')
const { restoreMonitorJobs } = require('./restore.ts') as typeof import('./restore.ts')
const { startCommentRetention } = require('./retention.ts') as typeof import('./retention.ts')
const { createServiceActions } = require('./service-actions.ts') as typeof import('./service-actions.ts')
const { clearAuthorContext } = require('./author-context.ts') as typeof import('./author-context.ts')
const { pendingReplies, activePendingReplies, nextVerificationAt } = require('./reply-verification.ts') as typeof import('./reply-verification.ts')
const { createCommentUnipileAdapter } = require('./unipile-adapter.ts') as
  { createCommentUnipileAdapter(options?: any): any }

const { createLinkedInAuthNocoRepository } = require('../account-connection/noco-repository.ts') as {
  createLinkedInAuthNocoRepository(): any
}

function createCommentMonitorService(options: any = {}) {
  const store = options.store ?? createCommentMonitorStore()
  const repository = options.repository ?? createLinkedInAuthNocoRepository()
  let adapter = options.adapter
  const getAdapter = () => adapter ??= createCommentUnipileAdapter()
  let openai: any
  const getOpenAi = () => openai ??= options.openai ?? createCommentOpenAi()
  const gate = options.gate
  const now = options.now ?? Date.now
  const jobs = new Map<string, MonitorJob>()
  const running = new Set<string>()
  const enabling = new Map<number, Promise<any>>()
  const loggerFor = (job: MonitorJob | { jobId: string; platformAccountId: number }) =>
    options.loggerFor?.(job) ?? createCommentLogger(job)
  let restoreError: unknown
  let closing = false

  async function save(job: MonitorJob, logger = loggerFor(job)) {
    await saveJob(store, job, logger); jobs.set(job.jobId, job)
  }
  async function run(job: MonitorJob, cooperate?: <T>(action: () => Promise<T>) => Promise<T>, verifyOnly = false) {
    if (closing) return
    if (job.status === 'disabled') return { status: 'stopped' as const }
    if (running.has(job.jobId)) return
    if ([...jobs.values()].some(other => other.state.verificationSources?.includes(job.jobId))) return
    const pending = activePendingReplies(job).length > 0
    if (job.status === 'error' && !pending) return
    const deadline = monitorRecovery(job).recoveryDeadlineAt
    const recoveryDue = deadline !== undefined && deadline <= now()
    if (!recoveryDue && (Date.parse(job.nextCheckAt ?? '') > now() ||
      (!pending && (!activeStatus(job.status) || job.status === 'paused')))) return
    running.add(job.jobId)
    const logger = loggerFor(job)
    try { return await withRequestContext({ runId: job.jobId, account: job.accountId, feature: 'comments',
      initiator: verifyOnly ? 'recovery' : job.state.automationId ? 'schedule' : 'manual' }, () =>
      pollMonitorJob({ job, store, adapter: getAdapter(), openai: { generate: (...args: any[]) =>
      getOpenAi().generate(...args) }, gate, logger, now, random: options.random, sleep: options.sleep, cooperate, isClosing: () => closing || verifyOnly })) }
    catch (error) {
      if (commentExecutionInterrupted(error)) {
        logger.event('monitor_run', 'failed', { errorCode: commentErrorCode(error) })
        if (job.state.automationId) throw error
        job.nextCheckAt = new Date(now() + 60_000).toISOString()
        return { status: activePendingReplies(job).length ? 'verifying' as const : 'waiting' as const,
          nextActionAt: job.nextCheckAt, reason: commentErrorCode(error) }
      }
      job.status = 'error'; job.stage = 'monitor_failed'; job.errorCode = commentErrorCode(error)
      job.finishedAt = new Date().toISOString(); clearAuthorContext(job, logger)
      await save(job, logger).catch(() => undefined)
      logger.event('monitor_run', 'failed', { errorCode: job.errorCode })
      return { status: 'needs_attention' as const, reason: job.errorCode }
    }
    finally { running.delete(job.jobId) }
  }
  let ready: Promise<void> | undefined, restoreRetryAt = 0
  async function assertReady() {
    if (!ready && restoreError && now() < restoreRetryAt) throw restoreError
    ready ??= (async () => {
      // Restore into a temporary collection: a partial SQL read/save never enables half a session set.
      const restored = new Map<string, MonitorJob>()
      await restoreMonitorJobs({ store, jobs: restored, loggerFor, now,
        save: (job, logger) => saveJob(store, job, logger ?? loggerFor(job)) })
      for (const [id, job] of restored) jobs.set(id, job)
      restoreError = undefined
    })().catch(error => {
      ready = undefined; restoreError = error; restoreRetryAt = now() + 60_000
      loggerFor({ jobId: 'comment-monitor-restore', platformAccountId: 0 })
        .event('session_restore', 'failed', { errorCode: String((error as any)?.code ?? 'internal') })
      throw error
    })
    await ready
  }
  async function tick() {
    try { await assertReady() } catch { return }
    await Promise.all([...jobs.values()].filter(job => !job.state.automationId).map(job => run(job)))
  }
  const timer = options.autoStart === false ? undefined : setInterval(tick, 15_000)
  const retentionTimer = options.autoStart === false ? undefined : startCommentRetention(store, loggerFor)
  timer?.unref?.(); void tick()

  async function enable(platformAccountId: number, automationId?: string) {
    await assertReady()
    const jobId = randomUUID(); const logger = loggerFor({ jobId, platformAccountId })
    logger.event('session_enable', 'started')
    const current = [...jobs.values()].find(job => job.platformAccountId === platformAccountId &&
      now() < Date.parse(job.expiresAt) &&
      job.status !== 'disabled' && (activeStatus(job.status) || activePendingReplies(job).length > 0))
    if (current) {
      logger.event('session_enable', 'succeeded', { reasonCode: 'existing_active_session' })
      return publicMonitorJob(current)
    }
    try {
      const { row, posts } = await withRequestContext({ runId: jobId, feature: 'comments',
        initiator: automationId ? 'schedule' : 'manual' }, () => selectPosts({ platformAccountId, repository,
        adapter: getAdapter(), logger }))
      const previous = [...jobs.values()].filter(job => job.accountId === row.unipileAccountId)
      const transferred = new Set(previous.flatMap(job => job.state.verificationSources ?? []))
      const sources = previous.filter(job => !transferred.has(job.jobId) && pendingReplies(job).length)
      const carried = structuredClone(sources.flatMap(job => pendingReplies(job).map(item => {
        if (job.status !== 'disabled' && !item.verificationStopped && item.recovery?.skippedAt === undefined) return item
        const quotaUntil = item.quotaUntil ?? job.expiresAt
        return { ...item, verificationStopped: true, quotaUntil,
          quotaReleased: item.quotaReleased || Date.parse(quotaUntil) <= now() }
      })))
      const threadReplies: Record<string, number> = {}
      for (const old of previous) for (const [id, count] of Object.entries(old.state.threadReplies))
        threadReplies[id] = Math.max(threadReplies[id] ?? 0, count)
      const timestamp = new Date(now()).toISOString()
      const job: MonitorJob = { jobId, platformAccountId, accountId: row.unipileAccountId,
        clientName: row.clientName, status: 'starting', stage: 'queued',
        state: { posts, items: carried, nextWorkAt: timestamp, verificationSources: [...transferred, ...sources.map(job => job.jobId)],
          providerNotBefore: sources.map(job => job.state.providerNotBefore).filter(Boolean).sort().at(-1),
          ...(automationId ? { automationId } : {}), knownIds: [...new Set([...previous.flatMap(job => [...job.state.knownIds,
            ...pendingReplies(job).map(item => item.incomingId)]),
            ...carried.map(item => item.incomingId)])],
          checks: 0, discovered: 0, published: 0, failed: 0, threadReplies }, nextCheckAt: timestamp,
        expiresAt: new Date(now() + SESSION_MS).toISOString(), createdAt: timestamp, updatedAt: timestamp }
      await createJob(store, job, logger); jobs.set(jobId, job)
      logger.event('session_enable', 'succeeded', { count: posts.length }); if (!automationId) void run(job)
      return publicMonitorJob(job)
    } catch (error) { logger.event('session_enable', 'failed', {
      errorCode: String((error as any)?.code ?? 'comment_monitor_internal_error') }); throw error }
  }
  return {
    async resumeManaged(id: string) {
      await assertReady(); const job = jobs.get(id)
      if (!job?.state.automationId || running.has(id))
        throw Object.assign(new Error('Нельзя возобновить эту сессию.'), { code: 'comment_monitor_resume_invalid' })
      if (['disabled', 'error', 'paused'].includes(job.status)) {
        job.status = now() >= Date.parse(job.expiresAt) ? 'completed' : 'waiting'
        job.nextCheckAt = new Date(Math.max(now(), Date.parse(job.nextCheckAt ?? '') || 0)).toISOString()
        job.errorCode = undefined; await save(job)
      }
    },
    async prepareManaged(platformAccountId: number, automationId: string, publishedAt = 0) {
      await assertReady()
      const previous = [...jobs.values()].filter(job => job.platformAccountId === platformAccountId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      const current = previous.find(job => job.status !== 'disabled' && now() < Date.parse(job.expiresAt) && (activePendingReplies(job).length ||
        activeStatus(job.status) || job.state.automationId))
      if (current) {
        if (!current.state.automationId) throw Object.assign(new Error('Ручной монитор ещё работает.'), { code: 'linkedin_operation_active' })
        // An active session may continue; a disabled session is never revived here.
        if (publishedAt > (current.state.postsCheckedForPublication ?? Date.parse(current.createdAt)) &&
          !activePendingReplies(current).length && current.state.published < SESSION_REPLY_LIMIT) {
          const selected = await selectPosts({ platformAccountId, repository, adapter: getAdapter(), logger: loggerFor(current) })
          current.state.posts = selected.posts; current.state.postsCheckedForPublication = publishedAt
          current.nextCheckAt = new Date(now()).toISOString(); await save(current)
        }
        return publicMonitorJob(current)
      }
      return enable(platformAccountId, automationId)
    },
    async stepManaged(jobId: string, stop = false, cooperate?: <T>(action: () => Promise<T>) => Promise<T>, verifyOnly = false) {
      await assertReady()
      const job = jobs.get(jobId)
      if (!job?.state.automationId) throw Object.assign(new Error('Автоматическая сессия не найдена.'), { code: 'comment_managed_job_missing' })
      if (stop && job.status !== 'disabled') {
        job.status = 'disabled'; job.stage = 'disabled_by_automation'
        if (activePendingReplies(job).length) job.nextCheckAt = new Date(Math.max(now() + 60_000,
          Date.parse(nextVerificationAt(job) ?? '') || 0, Date.parse(job.state.providerNotBefore ?? '') || 0)).toISOString()
        await save(job)
      }
      const pending = activePendingReplies(job).length > 0
      if (stop || job.status === 'disabled') return { status: 'stopped' as const,
        summary: { completed: job.state.published, skipped: job.state.failed, unconfirmed: pendingReplies(job).length } }
      if ([...jobs.values()].some(other => other.state.verificationSources?.includes(job.jobId)))
        return { status: 'completed' as const }
      if (!pending && ['error', 'paused'].includes(job.status)) return { status: 'needs_attention' as const, reason: job.errorCode }
      if (!pending && now() < Date.parse(job.expiresAt) && job.state.published >= SESSION_REPLY_LIMIT)
        return { status: 'waiting' as const, reason: 'session_limit', nextActionAt: job.expiresAt }
      const result = await run(job, cooperate, verifyOnly)
        if (verifyOnly && !activePendingReplies(job).length) return { ...result, status: 'completed' as const, ...monitorRecovery(job) }
        return result ?? { status: pending ? 'verifying' as const : 'waiting' as const,
          nextActionAt: job.nextCheckAt ?? (pending ? nextVerificationAt(job) : job.expiresAt), ...monitorRecovery(job) }
    },
    enable(platformAccountId: number) {
      const current = enabling.get(platformAccountId)
      if (current) return current
      const action = enable(platformAccountId).finally(() => enabling.delete(platformAccountId))
      enabling.set(platformAccountId, action); return action
    }, tick, ...createServiceActions({ assertReady, jobs, loggerFor, run, save, store }),
    stop() { closing = true; if (timer) clearInterval(timer); if (retentionTimer) clearInterval(retentionTimer) }
  }
}

module.exports = { createCommentMonitorService }
