const { profileErrorCode, profileErrorDetails } = require('../errors.ts') as
  typeof import('../errors.ts')
const { logAction } = require('../log-action.ts') as typeof import('../log-action.ts')
const { runPreview } = require('../preview-run.ts') as { runPreview(options: any): void }
const { groundJobTitles } = require('./job-title-grounding.ts') as
  typeof import('./job-title-grounding.ts')
const { persistStage } = require('./job-stage.ts') as typeof import('./job-stage.ts')
type GenerationCheckpoint = import('./types.ts').GenerationCheckpoint

async function groundAndPreview(options: any, checkpoint: GenerationCheckpoint) {
  const { job, store, update, release, logger } = options
  try {
    await logAction(logger, 'generation_stage_persist', () =>
      persistStage({ job, store, update }, 'validating', 'resolving_job_titles'),
      { operation: 'resolving_job_titles' })
    const grounded = await logAction(logger, 'job_title_catalog_prepare', () =>
      groundJobTitles({ client: options.client, accountId: job.accountId,
        input: checkpoint.profile, issues: checkpoint.issues, logger,
        choose: options.generator.chooseJobTitles?.bind(options.generator),
        retry: { ...options.catalogRetry, onRetry: async (retry: any) => {
          checkpoint.retry = { provider: 'unipile', ...retry }
          const now = new Date().toISOString()
          update({ status: 'retrying', phase: 'retrying_job_titles', checkpoint, updatedAt: now })
          await store.update(job.jobId, { status: 'retrying', phase: 'retrying_job_titles',
            checkpoint, updatedAt: now })
        } } }))
    checkpoint.retry = undefined
    await logAction(logger, 'generation_stage_persist', () =>
      persistStage({ job, store, update }, 'previewing', 'building_preview'),
      { operation: 'building_preview' })
    runPreview({ client: options.client, repository: options.repository, store, job,
      input: grounded.input, issues: grounded.issues, update, release, logger,
      generation: checkpoint.generation })
    return true
  } catch (error: any) {
    if (!error?.retryExhausted) throw error
    const now = new Date().toISOString()
    checkpoint.retry = { provider: 'unipile', attempt: 3 }
    const patch = { status: 'waiting_retry' as const, phase: 'waiting_unipile_retry',
      errorCode: profileErrorCode(error), checkpoint, updatedAt: now }
    update(patch)
    await store.update(job.jobId, patch).catch(() => undefined)
    logger.event('generation_waiting_retry', 'succeeded', profileErrorDetails(error))
    return false
  }
}

module.exports = { groundAndPreview }
