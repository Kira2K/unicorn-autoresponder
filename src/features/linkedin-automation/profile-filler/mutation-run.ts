import { executeProfilePlan } from './executor.ts'
import { profileErrorCode, profileErrorDetails } from './errors.ts'
import type { ProfileJob } from './job-types.ts'
import type { FillResult, ProfileClient } from './plan-types.ts'
import { createProfileLogger } from './profile-logger.ts'
import { logAction } from './log-action.ts'

export function runMutation(options: {
  client: ProfileClient
  store: any
  job: ProfileJob
  update(patch: Partial<ProfileJob>): void
  release(): void
  executorOptions?: any
}) {
  const { client, store, job, update, release, executorOptions } = options
  const logger = executorOptions?.logger ?? createProfileLogger({ jobId: job.jobId })
  const persistProgress = async (result: FillResult) => {
    const updatedAt = new Date().toISOString()
    update({ result, updatedAt })
    logger.event('progress_persist', 'started')
    await store.update(job.jobId, { result, phase: job.phase, updatedAt })
      .then(() => logger.event('progress_persist', 'succeeded'))
      .catch((error: unknown) => logger.event('progress_persist', 'failed', profileErrorDetails(error)))
  }
  void executeProfilePlan(client, job.plan!, {
    ...executorOptions,
    logger,
    onStage: (phase: string) => {
      update({ phase, updatedAt: new Date().toISOString() })
      logger.event('stage_change', 'succeeded', { operation: phase })
      executorOptions?.onStage?.(phase)
    },
    onProgress: async (result: FillResult) => {
      await persistProgress(result)
      await executorOptions?.onProgress?.(result)
    }
  }).then(async result => {
    const now = new Date().toISOString()
    const status = result.status === 'failed' ? 'needs_expert_review' :
      result.status === 'pending_verification' ? 'pending_verification' : 'succeeded'
    const phase = result.status === 'failed' ? 'verification_failed' :
      result.status === 'pending_verification' ? 'completed_pending_verification' : 'completed'
    const failed = result.steps.find(step => step.status === 'failed')
    const errorCode = failed?.errorCode ??
      (failed?.failureKind ? `profile_${failed.failureKind}` : undefined)
    update({ status, phase, result, errorCode, updatedAt: now, finishedAt: now })
    await logAction(logger, 'job_finish_persist', () => store.update(job.jobId,
      { status, phase, result, errorCode, updatedAt: now, finishedAt: now }), { errorCode })
  }).catch(async error => {
    const now = new Date().toISOString()
    const code = profileErrorCode(error)
    logger.event('run', 'failed', profileErrorDetails(error))
    update({ status: 'needs_expert_review', phase: 'execution_failed', errorCode: code,
      updatedAt: now, finishedAt: now })
    await logAction(logger, 'job_failure_persist', () => store.update(job.jobId,
      { status: 'needs_expert_review', phase: 'execution_failed', errorCode: code,
        updatedAt: now, finishedAt: now }), { errorCode: code }).catch(() => undefined)
  }).finally(() => {
    logger.event('operation_release', 'started')
    release()
    logger.event('operation_release', 'succeeded')
  })
}
