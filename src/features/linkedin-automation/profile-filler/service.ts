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
const { approvedSections, assertApprovedState } = require('./approved-state.ts') as typeof import('./approved-state.ts')
const { assertDistinctPlanTargets } = require('./entry-claims.ts') as typeof import('./entry-claims.ts')
const { createVerificationRecovery } = require('./verification-recovery.ts') as
  typeof import('./verification-recovery.ts')
const { resolveProfileAccount } = require('./profile-account.ts') as {
  resolveProfileAccount(repository: unknown, client: import('./plan-types.ts').ProfileClient,
    id: number, sections: string[]): Promise<{ account: import('./plan-types.ts').ProfileAccount;
      profile: import('./input-types.ts').JsonObject }>
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
  const verificationStarts = new Set<string>()
  const update = (job: ProfileJob, patch: Partial<ProfileJob>) => Object.assign(job, patch)
  const acquire = (kind: string, id: string, platformAccountId: number) =>
    gate?.acquire(kind, id, String(platformAccountId)) ?? (() => undefined)
  const loggerFor = (jobId: string) => options.executorOptions?.logger ?? createProfileLogger({ jobId })
  async function ensureVerification(job: ProfileJob) {
    if (verificationStarts.has(job.jobId)) return true
    if (job.status !== 'verifying' || !job.plan || !job.result) return false
    verificationStarts.add(job.jobId)
    const logger = loggerFor(job.jobId)
    try {
      const release = await logAction(logger, 'verification_operation_gate', () =>
        acquire('profile_verify', job.jobId, job.platformAccountId))
      jobs.set(job.jobId, job)
      runMutation({ client: getClient(), store: getStore(), job,
        update: patch => update(job, patch), release, resumeVerification: true,
        executorOptions: { ...options.executorOptions, logger,
          onSettled: () => verificationStarts.delete(job.jobId) } })
      return true
    } catch (error) {
      verificationStarts.delete(job.jobId)
      logger.event('verification_resume', 'failed', profileErrorDetails(error))
      return false
    }
  }
  const recovery = createVerificationRecovery({
    list: () => getStore().listPendingVerification?.() ?? getStore().list(),
    isActive: id => jobs.has(id) || verificationStarts.has(id),
    recover: job => recoverInterruptedJob(getStore(), job),
    resume: ensureVerification, logger: loggerFor('verification-recovery')
  })
  async function getJob(jobId: string) {
    const active = jobs.get(jobId)
    const job = active ?? await getStore().get(jobId)
    if (!job) return undefined
    if (!active) await recoverInterruptedJob(getStore(), job)
    if (job.status === 'verifying') void ensureVerification(job)
    return publicProfileJob(job)
  }
  async function listJobs() {
    return await Promise.all((await getStore().list()).map(async (stored: ProfileJob) => {
      const active = jobs.get(stored.jobId)
      const job = active ?? await recoverInterruptedJob(getStore(), stored)
      if (job.status === 'verifying') void ensureVerification(job)
      return publicProfileJob(job)
    }))
  }
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
          'waiting_retry', 'running', 'verifying'].includes(job.status))
      if (local) return publicProfileJob(local)
      const saved = (await getStore().list()).find((job: ProfileJob) =>
        job.platformAccountId === platformAccountId && (['waiting_retry', 'running', 'verifying']
          .includes(job.status) ||
          (job.checkpoint && ['validating', 'previewing', 'retrying'].includes(job.status))))
      if (saved) {
        await recoverInterruptedJob(getStore(), saved); jobs.set(saved.jobId, saved)
        if (saved.status === 'verifying') void ensureVerification(saved)
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
        assertDistinctPlanTargets(stored.plan)
        return stored
      })
      const plan = job.plan!
      const release = await logAction(logger, 'operation_gate', () =>
        acquire('profile_fill', jobId, job.platformAccountId))
      try {
        const fresh = await resolveProfileAccount(getRepository(), getClient(), job.platformAccountId, approvedSections(plan))
        if (fresh.account.accountId !== plan.account.accountId || fresh.account.providerId !== plan.account.providerId) {
          throw codedError('profile_preview_stale', 'Account identity changed; rebuild Preview.')
        }
        assertApprovedState(plan, fresh.profile)
      } catch (error) { release(); throw error }
      const now = new Date().toISOString()
      try { await logAction(logger, 'job_start_persist', () => getStore().update(jobId,
        { status: 'running', phase: 'starting', updatedAt: now })) }
      catch (error) { release(); throw error }
      update(job, { status: 'running', phase: 'starting', updatedAt: now })
      jobs.set(jobId, job)
      verificationStarts.add(jobId)
      runMutation({ client: getClient(), store: getStore(), job, update: patch => update(job, patch),
        release, executorOptions: { ...options.executorOptions, logger,
          onSettled: () => verificationStarts.delete(jobId) } })
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
  return { apply, recoverPending: recovery.start,
    get: getJob,
    list: listJobs,
    resume, rollback, searchParameters,
    startGeneration,
    startPreview
  }
}
module.exports = { createProfileFillerService }
