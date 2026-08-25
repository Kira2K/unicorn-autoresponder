const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
const { codedError, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { runGeneration } = require('./generation/run-generation.ts') as {
  runGeneration(options: any): Promise<void>
}
const { createNocoGenerationRepository } = require('./generation/noco-generation-context.ts') as {
  createNocoGenerationRepository(repository: any): any
}
const { normalizeUploadedCv } = require('./generation/uploaded-cv.ts') as
  typeof import('./generation/uploaded-cv.ts')
type ProfileJob = import('./job-types.ts').ProfileJob
const generationRepositories = new WeakMap<object, any>()

function generationRepository(authRepository: object, supplied?: any) {
  if (supplied) return supplied
  let repository = generationRepositories.get(authRepository)
  if (!repository) {
    repository = createNocoGenerationRepository(authRepository)
    generationRepositories.set(authRepository, repository)
  }
  return repository
}

async function startProfileGeneration(options: any) {
  const { platformAccountId, loggerFor, getRepository, getStore, getClient,
    acquire, jobs, update } = options
  const jobId = randomUUID()
  const logger = loggerFor(jobId)
  logger.event('generation_request', 'started')
  try {
    const rows = await logAction(logger, 'noco_account_list', () => getRepository().listAccounts())
    const row = rows.find((item: any) => Number(item.platformAccountId) === platformAccountId)
    if (!row) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
    if (!row.unipileAccountId || row.unipileAccountStatus !== 'running' || !row.lastVerifiedAt) {
      throw codedError('profile_filler_auth_required', 'Verify or reconnect LinkedIn first.')
    }
    const cv = options.upload ? await logAction(logger, 'cv_upload_validate', () =>
      normalizeUploadedCv(options.upload)) : undefined
    const now = new Date().toISOString()
    const job: ProfileJob = { jobId, platformAccountId, clientName: row.clientName,
      accountId: row.unipileAccountId, status: 'generating_cv', phase: 'queued',
      createdAt: now, updatedAt: now }
    const release = await logAction(logger, 'operation_gate', () =>
      acquire('profile_generate', jobId))
    jobs.set(jobId, job)
    try { await logAction(logger, 'job_create', () => getStore().create(job)) }
    catch (error) { jobs.delete(jobId); release(); throw error }
    const authRepository = getRepository()
    void runGeneration({ job, account: row, cv, repository: authRepository,
      generationRepository: cv ? undefined :
        generationRepository(authRepository, options.generationRepository),
      store: getStore(), client: getClient(),
      update: (patch: Partial<ProfileJob>) => update(job, patch), release, logger,
      runtime: options.generationRuntime })
    logger.event('generation_request', 'succeeded')
    return publicProfileJob(job)
  } catch (error) {
    logger.event('generation_request', 'failed', profileErrorDetails(error))
    throw error
  }
}

module.exports = { startProfileGeneration }
