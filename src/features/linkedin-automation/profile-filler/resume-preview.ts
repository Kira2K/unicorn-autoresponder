import type { ProfileJob } from './job-types.ts'
import type { ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import type { MutationStore } from './mutation-persistence.ts'
const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { codedError } = require('./errors.ts') as typeof import('./errors.ts')
const { previewSaveFailure, previewSaveRecovery } = require('./preview-save-state.ts') as typeof import('./preview-save-state.ts')
const { checkPreparation, preparationSignal, releasePreparation, stoppedPhase } = require('./generation/cancellation.ts') as
  typeof import('./generation/cancellation.ts')
const { runPreview } = require('./preview-run.ts') as { runPreview(options: {
  client: ProfileClient; repository: unknown; store: MutationStore; job: ProfileJob;
  input: import('./input-types.ts').ProfileInput; issues: import('./input-types.ts').ValidationIssue[];
  generation: import('./generation/types.ts').GenerationMetadata;
  catalogParameters?: import('./parameter-search.ts').ParameterSearchCache; logger: ProfileLogger;
  release(): void; update(patch: Partial<ProfileJob>): void
}): void }

export type ResumePreviewOptions = {
  job: ProfileJob; jobs: Map<string, ProfileJob>; store: MutationStore; client: ProfileClient;
  repository: unknown; logger: ProfileLogger;
  acquire(kind: string, id: string, account: number): (() => void) | Promise<() => void>
}
async function resumePreview(options: ResumePreviewOptions) {
  const { job, jobs, store, logger } = options
  const release = await options.acquire('profile_preview', job.jobId, job.platformAccountId)
  let handedOff = false
  let ownsPreparation = false
  try {
    if (!previewSaveRecovery(job)) throw codedError('profile_retry_not_ready', 'Подготовка уже продолжается или завершена.')
    const pending = job.checkpoint!.pendingPreview
    if (pending?.nextRetryAt && Date.parse(pending.nextRetryAt) > Date.now()) {
      throw codedError('noco_rate_limited', 'Дождитесь окончания паузы перед сохранением Preview.')
    }
    preparationSignal(job); checkPreparation(job)
    ownsPreparation = true
    Object.assign(job, { status: 'previewing', phase: 'saving_preview', updatedAt: new Date().toISOString() })
    jobs.set(job.jobId, job)
    if (!pending) {
      // Legacy failed jobs kept generated data, but not the final plan. Rebuild by reads, without a model client.
      const checkpoint = job.checkpoint!
      runPreview({ client: options.client, repository: options.repository, store, job,
        input: checkpoint.profile, issues: checkpoint.issues, generation: checkpoint.generation,
        catalogParameters: checkpoint.catalogParameters, logger, release,
        update: patch => Object.assign(job, patch) })
      handedOff = true
      return publicProfileJob(job)
    }
    const patch: Partial<ProfileJob> = { status: 'preview_ready', phase: 'preview_ready',
      accountId: pending.plan.account.accountId, plan: pending.plan, planHash: pending.planHash,
      checkpoint: null, errorCode: '', updatedAt: new Date().toISOString() }
    logger.event('preview_persist', 'started')
    try {
      await store.update(job.jobId, patch)
      checkPreparation(job)
      Object.assign(job, patch)
      logger.event('preview_persist', 'succeeded')
    } catch (error) {
      const stopped = stoppedPhase(job, '') === 'generation_stopped'
      const failed: Partial<ProfileJob> = stopped ? { status: 'failed', phase: 'generation_stopped',
        errorCode: 'profile_generation_stopped', updatedAt: new Date().toISOString() } : previewSaveFailure(job, error)
      Object.assign(job, failed)
      logger.event('preview_persist', 'failed', { errorCode: failed.errorCode })
      await store.update(job.jobId, failed).catch(() => undefined)
    }
    return publicProfileJob(job)
  } finally { if (!handedOff) { if (ownsPreparation) releasePreparation(job); release() } }
}
module.exports = { resumePreview }
