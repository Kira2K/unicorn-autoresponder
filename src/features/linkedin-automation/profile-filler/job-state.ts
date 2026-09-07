import { timingSafeEqual } from 'node:crypto'
import type { ProfileJob } from './job-types.ts'
import type { MutationStore } from './mutation-persistence.ts'

export function sameHash(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function interruptedJobPatch(job: ProfileJob): Partial<ProfileJob> | undefined {
  if (!['generating_cv', 'generating_profile', 'validating', 'previewing', 'retrying', 'running']
    .includes(job.status)) return undefined
  const now = new Date().toISOString()
  if (job.status === 'running' && job.plan && job.result?.steps.some(step =>
    step.writeIntent && step.status !== 'verified')) {
    const patch: Partial<ProfileJob> = { status: 'verifying', phase: 'recovering_write_result', updatedAt: now }
    return patch
  }
  if (job.status !== 'running' && job.checkpoint) {
    const patch: Partial<ProfileJob> = { status: 'waiting_retry', phase: 'interrupted_retryable',
      errorCode: 'profile_job_interrupted', updatedAt: now }
    return patch
  }
  const patch: Partial<ProfileJob> = {
    status: job.status === 'running' ? 'needs_expert_review' : 'failed',
    phase: 'interrupted', errorCode: 'profile_job_interrupted',
    updatedAt: now, finishedAt: now
  }
  return patch
}

export function profileReadView(job: ProfileJob, active: boolean) {
  const copy = structuredClone(job)
  return active ? copy : Object.assign(copy, interruptedJobPatch(copy))
}

export async function recoverInterruptedJob(store: MutationStore, job: ProfileJob) {
  const patch = interruptedJobPatch(job)
  if (!patch) return job
  await store.update(job.jobId, patch)
  Object.assign(job, patch)
  return job
}
