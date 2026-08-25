const { createUnipileProfileAdapter } = require('../../../integrations/unipile/profile-adapter.ts') as
  { createUnipileProfileAdapter(): any }
const { codedError, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { sameHash } = require('./job-state.ts') as
  { sameHash(left: string, right: string): boolean }
const { runMutation } = require('./mutation-run.ts') as typeof import('./mutation-run.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { createProfileLogger } = require('./profile-logger.ts') as typeof import('./profile-logger.ts')
const { startProfilePreview } = require('./start-preview.ts') as
  { startProfilePreview(options: any): Promise<any> }
const { startProfileGeneration } = require('./start-generation.ts') as
  { startProfileGeneration(options: any): Promise<any> }
const { resumeProfileGeneration } = require('./resume-generation.ts') as
  { resumeProfileGeneration(options: any): Promise<any> }
const { recoverInterruptedJob } = require('./job-state.ts') as
  { recoverInterruptedJob(store: any, job: ProfileJob): Promise<ProfileJob> }
const { findParameterOptions } = require('./parameter-options.ts') as
  typeof import('./parameter-options.ts')
const { getPublicJob, listPublicJobs } = require('./service-queries.ts') as {
  getPublicJob(store: any, jobs: Map<string, ProfileJob>, id: string): Promise<any>
  listPublicJobs(store: any, jobs: Map<string, ProfileJob>): Promise<any[]>
}
const { startRollback } = require('./rollback.ts') as { startRollback(options: any): Promise<any> }
type ProfileJob = import('./job-types.ts').ProfileJob
const { createLinkedInAuthNocoRepository } = require('../account-connection/noco-repository.ts') as
  { createLinkedInAuthNocoRepository(): any }
const { createProfileJobStore } = require('./noco-job-store.ts') as
  { createProfileJobStore(): any }
function createProfileFillerService(options: any = {}) {
  let repository = options.repository
  let client = options.client
  let store = options.store
  const getRepository = () => repository ??= createLinkedInAuthNocoRepository()
  const getClient = () => client ??= createUnipileProfileAdapter()
  const getStore = () => store ??= createProfileJobStore()
  const gate = options.gate
  const jobs = new Map<string, ProfileJob>()
  const generationStarts = new Map<number, Promise<any>>()
  const update = (job: ProfileJob, patch: Partial<ProfileJob>) => Object.assign(job, patch)
  const acquire = (kind: string, id: string, platformAccountId: number) =>
    gate?.acquire(kind, id, String(platformAccountId)) ?? (() => undefined)
  const loggerFor = (jobId: string) => options.executorOptions?.logger ?? createProfileLogger({ jobId })
  async function startPreview(platformAccountId: number, profileFile: unknown) {
    return startProfilePreview({ platformAccountId, profileFile, loggerFor, getRepository, getStore,
      getClient, acquire, jobs, update })
  }
  async function startGeneration(platformAccountId: number, upload?: any) {
    const pending = generationStarts.get(platformAccountId)
    if (pending) return pending
    const request = (async () => {
      const local = [...jobs.values()].find(job => job.platformAccountId === platformAccountId &&
        ['generating_cv', 'generating_profile', 'validating', 'previewing', 'retrying',
          'waiting_retry'].includes(job.status))
      if (local) return publicProfileJob(local)
      const saved = (await getStore().list()).find((job: ProfileJob) =>
        job.platformAccountId === platformAccountId && (job.status === 'waiting_retry' ||
          (job.checkpoint && ['validating', 'previewing', 'retrying'].includes(job.status))))
      if (saved) {
        await recoverInterruptedJob(getStore(), saved); jobs.set(saved.jobId, saved)
        return publicProfileJob(saved)
      }
      return startProfileGeneration({ platformAccountId, loggerFor, getRepository, getStore,
        getClient, acquire, jobs, update, generationRuntime: options.generationRuntime,
        generationRepository: options.generationRepository, upload })
    })()
    generationStarts.set(platformAccountId, request)
    try { return await request }
    finally { if (generationStarts.get(platformAccountId) === request) generationStarts.delete(platformAccountId) }
  }
  async function resume(jobId: string) {
    return resumeProfileGeneration({ jobId, jobs, store: getStore(), client: getClient(),
      repository: getRepository(), acquire, update, logger: loggerFor(jobId),
      runtime: options.generationRuntime })
  }
  async function searchParameters(platformAccountId: number, type: string, keywords: string) {
    return findParameterOptions({ repository: getRepository(), client: getClient(),
      platformAccountId, type, keywords, logger: loggerFor(`parameter-${platformAccountId}`) })
  }
  async function apply(jobId: string, hash: string) {
    const logger = loggerFor(jobId)
    logger.event('apply_request', 'started')
    try {
      const stored = jobs.get(jobId) ?? await logAction(logger, 'job_read', () => getStore().get(jobId))
      const job: ProfileJob = await logAction(logger, 'apply_preconditions', () => {
        if (!stored) throw codedError('profile_job_not_found', 'Profile job was not found.')
        if (stored.status !== 'preview_ready' || !stored.plan || !stored.planHash) {
          throw codedError('profile_job_not_ready', 'Profile preview is not ready.')
        }
        if (!sameHash(stored.planHash, hash)) {
          throw codedError('profile_plan_hash_mismatch', 'Profile plan hash does not match.')
        }
        if (stored.plan.issues.some((item: import('./input-types.ts').ValidationIssue) =>
          item.level === 'fatal')) {
          throw codedError('profile_preview_has_blocking_issues',
            'Profile preview contains blocking issues.')
        }
        return stored
      })
      const plan = job.plan!
      const release = await logAction(logger, 'operation_gate', () =>
        acquire('profile_fill', jobId, job.platformAccountId))
      const now = new Date().toISOString()
      update(job, { status: 'running', phase: 'starting', updatedAt: now })
      try { await logAction(logger, 'job_start_persist', () => getStore().update(jobId,
        { status: 'running', phase: 'starting', updatedAt: now })) }
      catch (error) { release(); throw error }
      jobs.set(jobId, job)
      runMutation({ client: getClient(), store: getStore(), job, update: patch => update(job, patch),
        release, executorOptions: { ...options.executorOptions, logger } })
      logger.event('apply_request', 'succeeded', { stepCount: plan.steps.length })
      return publicProfileJob(job)
    } catch (error) {
      logger.event('apply_request', 'failed', profileErrorDetails(error))
      throw error
    }
  }
  async function rollback(sourceJobId: string) {
    return await startRollback({ sourceJobId, jobs, store: getStore(), client: getClient(),
      repository: getRepository(), acquire, executorOptions: options.executorOptions })
  }
  return { apply,
    get: (jobId: string) => getPublicJob(getStore(), jobs, jobId),
    list: () => listPublicJobs(getStore(), jobs),
    resume, rollback, searchParameters,
    startGeneration,
    startPreview
  }
}
module.exports = { createProfileFillerService }
