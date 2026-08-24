const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')
type ProfileJob = import('./job-types.ts').ProfileJob

function sameHash(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function recoverInterruptedJob(store: any, job: ProfileJob) {
  if (!['previewing', 'running'].includes(job.status)) return job
  const now = new Date().toISOString()
  const patch: Partial<ProfileJob> = {
    status: job.status === 'running' ? 'needs_expert_review' : 'failed',
    phase: 'interrupted', errorCode: 'profile_job_interrupted',
    updatedAt: now, finishedAt: now
  }
  Object.assign(job, patch)
  await store.update(job.jobId, patch)
  return job
}

module.exports = { recoverInterruptedJob, sameHash }
