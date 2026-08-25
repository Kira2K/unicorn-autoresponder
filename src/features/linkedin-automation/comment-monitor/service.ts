import type { MonitorJob } from './types.ts'

const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
const { createCommentLogger } = require('./logger.ts') as typeof import('./logger.ts')
const { createCommentMonitorStore } = require('./noco-store.ts') as {
  createCommentMonitorStore(client?: any): any
}
const { createCommentOpenAi } = require('./openai-client.ts') as typeof import('./openai-client.ts')
const { commentErrorCode } = require('./errors.ts') as typeof import('./errors.ts')
const { pollMonitorJob } = require('./poll-job.ts') as typeof import('./poll-job.ts')
const { selectPosts } = require('./post-selection.ts') as typeof import('./post-selection.ts')
const { SESSION_MS } = require('./schedule.ts') as typeof import('./schedule.ts')
const { createJob, saveJob } = require('./job-save.ts') as typeof import('./job-save.ts')
const { activeStatus, publicMonitorJob } = require('./types.ts') as typeof import('./types.ts')
const { restoreMonitorJobs } = require('./restore.ts') as typeof import('./restore.ts')
const { startCommentRetention } = require('./retention.ts') as typeof import('./retention.ts')
const { createServiceActions } = require('./service-actions.ts') as typeof import('./service-actions.ts')
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
  const jobs = new Map<string, MonitorJob>()
  const running = new Set<string>()
  const loggerFor = (job: MonitorJob | { jobId: string; platformAccountId: number }) =>
    options.loggerFor?.(job) ?? createCommentLogger(job)
  let restoreError: unknown

  async function save(job: MonitorJob, logger = loggerFor(job)) {
    await saveJob(store, job, logger); jobs.set(job.jobId, job)
  }
  async function run(job: MonitorJob) {
    if (running.has(job.jobId) || !activeStatus(job.status) || job.status === 'paused') return
    running.add(job.jobId)
    const logger = loggerFor(job)
    try { await pollMonitorJob({ job, store, adapter: getAdapter(), openai: getOpenAi(), gate,
      logger, random: options.random, sleep: options.sleep }) }
    catch (error) {
      job.status = 'error'; job.stage = 'monitor_failed'; job.errorCode = commentErrorCode(error)
      job.finishedAt = new Date().toISOString(); await save(job, logger).catch(() => undefined)
      logger.event('monitor_run', 'failed', { errorCode: job.errorCode })
    }
    finally { running.delete(job.jobId) }
  }
  const ready = restoreMonitorJobs({ store, jobs, loggerFor, save }).catch(error => { restoreError = error
    loggerFor({ jobId: 'comment-monitor-restore', platformAccountId: 0 })
      .event('session_restore', 'failed', { errorCode: String((error as any)?.code ?? 'internal') }) })
  async function assertReady() { await ready; if (restoreError) throw restoreError }
  async function tick() {
    await assertReady().catch(() => undefined)
    for (const job of jobs.values()) if (job.status !== 'paused' && activeStatus(job.status) &&
      (!job.nextCheckAt || Date.parse(job.nextCheckAt) <= Date.now())) void run(job)
  }
  const timer = options.autoStart === false ? undefined : setInterval(tick, 15_000)
  const retentionTimer = options.autoStart === false ? undefined : startCommentRetention(store, loggerFor)
  timer?.unref?.(); void tick()

  async function enable(platformAccountId: number) {
    await assertReady()
    const jobId = randomUUID(); const logger = loggerFor({ jobId, platformAccountId })
    logger.event('session_enable', 'started')
    const current = [...jobs.values()].find(job => job.platformAccountId === platformAccountId &&
      activeStatus(job.status))
    if (current) {
      logger.event('session_enable', 'succeeded', { reasonCode: 'existing_active_session' })
      return publicMonitorJob(current)
    }
    try {
      const { row, posts } = await selectPosts({ platformAccountId, repository,
        adapter: getAdapter(), logger })
      const now = new Date().toISOString()
      const job: MonitorJob = { jobId, platformAccountId, accountId: row.unipileAccountId,
        clientName: row.clientName, status: 'starting', stage: 'queued',
        state: { posts, items: [], knownIds: [], checks: 0, discovered: 0, published: 0,
          failed: 0, threadReplies: {} }, nextCheckAt: now,
        expiresAt: new Date(Date.parse(now) + SESSION_MS).toISOString(), createdAt: now, updatedAt: now }
      await createJob(store, job, logger); jobs.set(jobId, job)
      logger.event('session_enable', 'succeeded', { count: posts.length }); void run(job)
      return publicMonitorJob(job)
    } catch (error) { logger.event('session_enable', 'failed', {
      errorCode: String((error as any)?.code ?? 'comment_monitor_internal_error') }); throw error }
  }
  return { enable, ...createServiceActions({ assertReady, jobs, loggerFor, run, save, store }),
    stop() { if (timer) clearInterval(timer); if (retentionTimer) clearInterval(retentionTimer) }
  }
}

module.exports = { createCommentMonitorService }
