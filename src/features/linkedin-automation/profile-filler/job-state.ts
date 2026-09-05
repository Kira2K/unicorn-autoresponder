import { timingSafeEqual } from 'node:crypto'
import type { ProfileJob } from './job-types.ts'
import type { MutationStore } from './mutation-persistence.ts'

export function sameHash(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function recoverInterruptedJob(store: MutationStore, job: ProfileJob) {
  if (!['generating_cv', 'generating_profile', 'validating', 'previewing', 'retrying', 'running']
    .includes(job.status)) return job
  const now = new Date().toISOString()
  if (job.status === 'running' && job.plan && job.result?.steps.some(step =>
    step.writeIntent && step.status !== 'verified')) {
    const patch: Partial<ProfileJob> = { status: 'verifying', phase: 'recovering_write_result', updatedAt: now }
    await store.update(job.jobId, patch)
    Object.assign(job, patch)
    return job
  }
  if (job.status !== 'running' && job.checkpoint) {
    const patch: Partial<ProfileJob> = { status: 'waiting_retry', phase: 'interrupted_retryable',
      errorCode: 'profile_job_interrupted', updatedAt: now }
    Object.assign(job, patch); await store.update(job.jobId, patch); return job
  }
  const patch: Partial<ProfileJob> = {
    status: job.status === 'running' ? 'needs_expert_review' : 'failed',
    phase: 'interrupted', errorCode: 'profile_job_interrupted',
    updatedAt: now, finishedAt: now
  }
  Object.assign(job, patch)
  await store.update(job.jobId, patch)
  return job
}
