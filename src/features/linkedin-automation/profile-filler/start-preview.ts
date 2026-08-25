const { randomUUID } = require('node:crypto') as typeof import('node:crypto')
const { codedError, profileErrorDetails } = require('./errors.ts') as typeof import('./errors.ts')
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { runPreview } = require('./preview-run.ts') as { runPreview(options: any): void }
const { validateProfileFile } = require('./validator.ts') as typeof import('./validator.ts')
const { logValidationFields } = require('./validation-logging.ts') as
  typeof import('./validation-logging.ts')
type ProfileJob = import('./job-types.ts').ProfileJob
type ProfileLogger = import('./profile-logger.ts').ProfileLogger

async function startProfilePreview(options: any) {
  const { platformAccountId, profileFile, loggerFor, getRepository, getStore, getClient,
    acquire, jobs, update } = options
  const jobId = randomUUID()
  const logger: ProfileLogger = loggerFor(jobId)
  logger.event('preview_request', 'started')
  try {
    const validation = await logAction(logger, 'input_validation', () =>
      validateProfileFile(profileFile))
    logValidationFields(logger, validation.normalized, validation.issues)
    logger.event('validation_summary', 'succeeded', {
      issueCount: validation.issues.length,
      fatalCount: validation.issues.filter(item => item.level === 'fatal').length
    })
    if (!validation.value || validation.issues.some(item => item.level === 'fatal')) {
      throw codedError('profile_validation_failed', 'Profile JSON is invalid.', validation.issues)
    }
    const rows = await logAction(logger, 'noco_account_list', () => getRepository().listAccounts())
    const row = rows.find((item: any) => Number(item.platformAccountId) === platformAccountId)
    if (!row) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
    const now = new Date().toISOString()
    const job: ProfileJob = {
      jobId, platformAccountId, accountId: row.unipileAccountId, clientName: row.clientName,
      status: 'previewing', phase: 'queued', createdAt: now, updatedAt: now
    }
    const release = await logAction(logger, 'operation_gate', () =>
      acquire('profile_preview', jobId, platformAccountId))
    try { await logAction(logger, 'job_create', () => getStore().create(job)) }
    catch (error) { release(); throw error }
    jobs.set(jobId, job)
    runPreview({ client: getClient(), repository: getRepository(), store: getStore(), job,
      input: validation.value, issues: validation.issues,
      update: (patch: Partial<ProfileJob>) => update(job, patch), release, logger })
    logger.event('preview_request', 'succeeded')
    return publicProfileJob(job)
  } catch (error) {
    logger.event('preview_request', 'failed', profileErrorDetails(error))
    throw error
  }
}

module.exports = { startProfilePreview }
