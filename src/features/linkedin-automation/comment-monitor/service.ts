import type { MonitorJob, TrackedPost } from './types.ts'

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
const { clearAuthorContext } = require('./author-context.ts') as typeof import('./author-context.ts')
const { reconcileUncertain } = require('./reply-verification.ts') as typeof import('./reply-verification.ts')
const { includePublication } = require('./include-publication.ts') as typeof import('./include-publication.ts')
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
  const enabling = new Map<number,Promise<any>>(), maintaining = new Map<number,Promise<any>>()
  function oneAtATime(map:Map<number,Promise<any>>,account:number,action:()=>Promise<any>) {
    const prior=map.get(account);if(prior)return prior
    const pending=action().finally(()=>map.delete(account));map.set(account,pending);return pending
  }
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
      logger, random: options.random, sleep: options.sleep, executionGuard:options.executionGuard }) }
    catch (error) {
      job.status = 'error'; job.stage = 'monitor_failed'; job.errorCode = commentErrorCode(error)
      job.finishedAt = new Date().toISOString(); clearAuthorContext(job, logger)
      await save(job, logger).catch(() => undefined)
      logger.event('monitor_run', 'failed', { errorCode: job.errorCode })
    }
    finally { running.delete(job.jobId) }
  }
  const ready = (options.readOnly ? store.list().then((values:MonitorJob[])=>values.forEach(j=>jobs.set(j.jobId,j))) :
    restoreMonitorJobs({ store, jobs, loggerFor, save })).catch((error:unknown) => { restoreError = error
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
  timer?.unref?.(); if (options.autoStart !== false) void tick()

  const enable=(account:number,key?:string,publication?:TrackedPost)=>oneAtATime(enabling,account,()=>enableJob(account,key,publication))
  async function enableJob(platformAccountId: number, automationKey?: string, publication?:TrackedPost) {
    await assertReady()
    await options.assertWrite?.()
    await options.executionGuard?.beforeWrite(platformAccountId,'comments',automationKey)
    const jobId = randomUUID(); const logger = loggerFor({ jobId, platformAccountId })
    logger.event('session_enable', 'started')
    const current = [...jobs.values()].find(job => job.platformAccountId === platformAccountId &&
      activeStatus(job.status))
    if (current) {
      logger.event('session_enable', 'succeeded', { reasonCode: 'existing_active_session' })
      return publicMonitorJob(current)
    }
    const previous = automationKey ? [...jobs.values()].filter(j=>j.platformAccountId===platformAccountId)
      .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0] : undefined
    if(automationKey && [...jobs.values()].some(j=>j.platformAccountId===platformAccountId &&
      j.state.items.some(i=>['publishing','uncertain'].includes(i.status))))
      throw Object.assign(Error('comment_reply_uncertain'),{code:'comment_reply_uncertain'})
    try {
      const { row, posts } = await selectPosts({ platformAccountId, repository,
        adapter: getAdapter(), logger })
      await options.executionGuard?.beforeWrite(platformAccountId,'comments',automationKey)
      const now = new Date().toISOString()
      const samePeriod=Boolean(previous?.state.automationKey && Date.parse(previous.expiresAt)>Date.parse(now))
      const job: MonitorJob = { jobId, platformAccountId, accountId: row.unipileAccountId,
        clientName: row.clientName, status: 'starting', stage: 'queued',
        state: samePeriod ? {...structuredClone(previous!.state),automationKey} :
          { posts, items: [], knownIds: previous?.state.knownIds ?? [], checks: 0, discovered: 0, published: 0, automationKey,
          failed: 0, threadReplies: previous?.state.threadReplies ?? {} }, nextCheckAt: now,
        expiresAt: samePeriod ? previous!.expiresAt : new Date(Date.parse(now) + SESSION_MS).toISOString(),
        createdAt: samePeriod ? previous!.createdAt : now, updatedAt: now }
      if (automationKey) job.state.posts=includePublication(job.state.posts,publication)
      await createJob(store, job, logger); jobs.set(jobId, job)
      logger.event('session_enable', 'succeeded', { count: posts.length }); void run(job)
      return publicMonitorJob(job)
    } catch (error) { logger.event('session_enable', 'failed', {
      errorCode: String((error as any)?.code ?? 'comment_monitor_internal_error') }); throw error }
  }
  const ensureAutomatic=(account:number,key:string,publication?:TrackedPost)=>oneAtATime(maintaining,account,()=>maintainAutomatic(account,key,publication))
  async function maintainAutomatic(platformAccountId:number,key:string,publication?:TrackedPost) {
    await assertReady()
    const job = [...jobs.values()].find(j => j.platformAccountId === platformAccountId && j.state.automationKey === key)
    if (!job) return enable(platformAccountId,key,publication)
    if (running.has(job.jobId)) return publicMonitorJob(job)
    running.add(job.jobId)
    let checkAfter=false
    try {
      if(job.state.items.some(i=>i.status==='uncertain')) {
        if(!job.nextCheckAt) {job.nextCheckAt=new Date(Date.now()+300000).toISOString();await save(job);return publicMonitorJob(job)}
        if(Date.parse(job.nextCheckAt)>Date.now())return publicMonitorJob(job)
        await options.executionGuard?.beforeWrite(platformAccountId,'comments',key)
        const release=gate?.acquire('comment_monitor_verify',job.jobId,String(platformAccountId))
        try {await reconcileUncertain({job,adapter:getAdapter(),logger:loggerFor(job),save:()=>save(job)})}
        finally {release?.()}
        job.status=Date.parse(job.expiresAt)<=Date.now()?'completed':'waiting';job.errorCode=undefined
        job.nextCheckAt=new Date().toISOString();await save(job)
      }
      if(Date.parse(job.expiresAt)>Date.now()) {
        const posts=includePublication(job.state.posts,publication)
        const changed=posts!==job.state.posts && posts.some(p=>p.id===publication?.id)
        const resume=job.stage.startsWith('automation_comments_')
        if (changed || resume) await options.executionGuard?.beforeWrite(platformAccountId,'comments',key)
        if (changed) {
          job.state.posts=posts
          loggerFor(job).event('published_post_added','succeeded',{count:posts.length})
        }
        // Resume promptly after another feature or inactive day, but do not bypass a provider pause or reply limit.
        if ((changed || resume) && job.status==='waiting' && job.state.published<30 &&
          (job.stage==='waiting_next_check' || job.stage==='restored' || job.stage.startsWith('automation_comments_'))) {
          job.stage='waiting_next_check';job.errorCode=undefined;job.nextCheckAt=new Date().toISOString();checkAfter=true
        }
        if (changed || checkAfter) await save(job)
        return publicMonitorJob(job)
      }
      if(job.state.items.some(i=>['publishing','uncertain'].includes(i.status)))return publicMonitorJob(job)
      if (!['completed','waiting'].includes(job.status)) return publicMonitorJob(job)
      await options.executionGuard?.beforeWrite(platformAccountId,'comments',key)
      const logger = loggerFor(job)
      const {posts} = await selectPosts({platformAccountId,repository,adapter:getAdapter(),logger})
      await options.executionGuard?.beforeWrite(platformAccountId,'comments',key)
      const at = Date.now()
      // Keep the same durable identity and lifetime deduplication; only the 48-hour session counters reset.
      job.state = {...job.state,posts:includePublication(posts,publication),items:[],checks:0,discovered:0,published:0,failed:0,
        sessionNumber:(job.state.sessionNumber ?? 0)+1}
      job.createdAt = new Date(at).toISOString(); job.expiresAt = new Date(at+SESSION_MS).toISOString()
      job.status='waiting';job.stage='session_renewed';job.finishedAt=undefined;job.errorCode=undefined
      job.nextCheckAt=job.createdAt
      await save(job);logger.event('session_renewed','succeeded');checkAfter=true
      return publicMonitorJob(job)
    } finally {running.delete(job.jobId);if(checkAfter)void run(job)}
  }
  return { enable, ensureAutomatic, ...createServiceActions({ assertReady, jobs, loggerFor, run, save, store,
    assertWrite:options.assertWrite,readOnly:options.readOnly }),
    async stop() {
      if (timer) clearInterval(timer); if (retentionTimer) clearInterval(retentionTimer)
      await Promise.allSettled([...enabling.values(),...maintaining.values()])
      while(running.size)await new Promise(resolve=>setTimeout(resolve,100))
    }
  }
}

module.exports = { createCommentMonitorService }
