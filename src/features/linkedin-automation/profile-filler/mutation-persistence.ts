import type { ProfileJob } from './job-types.ts'
import type { FillResult } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { codedError, profileErrorDetails } from './errors.ts'
import { hasOmittedSkills } from './skill-selection.ts'

export type MutationStore = { update(id: string, patch: Partial<ProfileJob>): Promise<unknown> }
export type MutationContext = {
  store: MutationStore; job: ProfileJob; logger: ProfileLogger
  update(patch: Partial<ProfileJob>): void
}

export async function persistMutation(context: MutationContext, result: FillResult, readOnly = false) {
  const { store, job, update, logger } = context
  const patch: Partial<ProfileJob> = { result, phase: job.phase, updatedAt: new Date().toISOString(),
    status: result.status === 'verifying' ? 'verifying' : job.status }
  logger.event('progress_persist', 'started')
  try { await store.update(job.jobId, patch) }
  catch (error) {
    logger.event('progress_persist', 'failed', profileErrorDetails(error))
    if (!readOnly) throw codedError('profile_state_persist_failed',
      'State could not be saved; further profile writes are blocked.')
    update(patch)
    return
  }
  update(patch)
  logger.event('progress_persist', 'succeeded')
}

export async function finishMutation(context: MutationContext, result: FillResult) {
  const { store, job, update, logger } = context
  const failed = result.steps.find(step => step.status !== 'verified')
  const partial = !failed && hasOmittedSkills(job.plan?.issues ?? [])
  const finishedAt = new Date().toISOString()
  const patch: Partial<ProfileJob> = {
    status: failed || partial ? 'needs_expert_review' : 'succeeded',
    phase: failed ? 'verification_failed' : partial ? 'partially_completed' : 'completed_verified',
    result, errorCode: failed?.errorCode, updatedAt: finishedAt, finishedAt
  }
  logger.event('job_finish_persist', 'started')
  await store.update(job.jobId, patch)
  update(patch)
  logger.event('job_finish_persist', 'succeeded')
}
