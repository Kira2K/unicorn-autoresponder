const { codedError, profileErrorCode, profileErrorDetails } = require('./errors.ts') as
  typeof import('./errors.ts')
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { logAction } = require('./log-action.ts') as typeof import('./log-action.ts')
const { createGenerationRuntime } = require('./generation/runtime.ts') as
  { createGenerationRuntime(value?: any, logger?: any): any }
const { groundAndPreview } = require('./generation/ground-and-preview.ts') as
  { groundAndPreview(options: any, checkpoint: any): Promise<boolean> }
const { validCheckpoint } = require('./generation/checkpoint.ts') as
  typeof import('./generation/checkpoint.ts')

async function resumeProfileGeneration(options: any) {
  const { jobId, jobs, store, acquire, update, logger } = options
  logger.event('generation_resume_request', 'started')
  const job = jobs.get(jobId) ?? await logAction(logger, 'job_read', () => store.get(jobId))
  if (!job) throw codedError('profile_job_not_found', 'Profile job was not found.')
  if (job.status !== 'waiting_retry') {
    throw codedError('profile_retry_not_ready', 'Profile generation is not waiting for retry.')
  }
  if (!validCheckpoint(job.checkpoint)) {
    throw codedError('profile_retry_unavailable', 'Profile generation checkpoint is unavailable.')
  }
  const release = await logAction(logger, 'operation_gate', () =>
    acquire('profile_generate', jobId, job.platformAccountId))
  const now = new Date().toISOString()
  update(job, { status: 'retrying', phase: 'resuming_job_titles', errorCode: undefined,
    updatedAt: now })
  await store.update(jobId, { status: 'retrying', phase: 'resuming_job_titles',
    errorCode: '', updatedAt: now })
  jobs.set(jobId, job)
  void (async () => {
    let handedToPreview = false
    try {
      const runtime = createGenerationRuntime(options.runtime, logger)
      handedToPreview = await groundAndPreview({ ...options, job, generator: runtime.generator,
        update: (patch: any) => update(job, patch), release, logger,
        catalogRetry: options.runtime?.catalogRetry }, job.checkpoint)
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const patch = { status: 'failed' as const, phase: 'generation_failed',
        errorCode: profileErrorCode(error), updatedAt: finishedAt, finishedAt }
      update(job, patch); await store.update(jobId, patch).catch(() => undefined)
      logger.event('generation_resume_request', 'failed', profileErrorDetails(error))
    } finally {
      if (!handedToPreview) {
        logger.event('operation_release', 'started'); release()
        logger.event('operation_release', 'succeeded')
      }
    }
  })()
  logger.event('generation_resume_request', 'succeeded')
  return publicProfileJob(job)
}

module.exports = { resumeProfileGeneration }
