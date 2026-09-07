import { executeProfilePlan, resumeProfileVerification, type ExecutorOptions } from './executor.ts'
import { profileErrorCode, profileErrorDetails } from './errors.ts'
import type { ProfileJob } from './job-types.ts'
import type { ProfileClient } from './plan-types.ts'
import { createProfileLogger } from './profile-logger.ts'
import { finishMutation, persistMutation, type MutationStore } from './mutation-persistence.ts'

export function runMutation(options: {
  client: ProfileClient; store: MutationStore; job: ProfileJob
  update(patch: Partial<ProfileJob>): void
  release(): void
  resumeVerification?: boolean
  executorOptions?: ExecutorOptions & { onSettled?(): void }
}) {
  const { client, store, job, update, release, executorOptions = {} } = options
  const logger = executorOptions.logger ?? createProfileLogger({ jobId: job.jobId })
  const context = { store, job, update, logger }
  const settings = (readOnly: boolean): ExecutorOptions => ({
    ...executorOptions, logger,
    onStage: phase => {
      update({ phase, updatedAt: new Date().toISOString() })
      logger.event('stage_change', 'succeeded', { operation: phase })
      executorOptions.onStage?.(phase)
    },
    onProgress: async result => {
      await persistMutation(context, result, readOnly)
      await executorOptions.onProgress?.(result)
    }
  })
  const execute = async () => {
    try {
      const result = options.resumeVerification
        ? await resumeProfileVerification(client, job.plan!, job.result!, settings(true))
        : await executeProfilePlan(client, job.plan!, settings(false))
      await finishMutation(context, result)
    } catch (error) {
      logger.event('run', 'failed', profileErrorDetails(error))
      const hasIntent = job.result?.steps.some(step => step.writeIntent && step.status !== 'verified')
      if (hasIntent && !options.resumeVerification) {
        update({ status: 'verifying', phase: 'recovering_write_result' })
        logger.event('writes_blocked', 'succeeded', profileErrorDetails(error))
        const result = await resumeProfileVerification(client, job.plan!, job.result!, settings(true))
        await finishMutation(context, result)
        return
      }
      throw error
    }
  }
  void execute().catch(async error => {
    const now = new Date().toISOString()
    const patch: Partial<ProfileJob> = { status: 'needs_expert_review', phase: 'execution_failed',
      errorCode: profileErrorCode(error), updatedAt: now, finishedAt: now }
    update(patch)
    try { await store.update(job.jobId, patch) }
    catch (persistError) { logger.event('job_failure_persist', 'failed', profileErrorDetails(persistError)) }
  }).finally(() => {
    logger.event('operation_release', 'started')
    release()
    logger.event('operation_release', 'succeeded')
    executorOptions.onSettled?.()
  })
}
