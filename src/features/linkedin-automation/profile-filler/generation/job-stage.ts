import type { ProfileJob, ProfileJobStatus } from '../job-types.ts'

export async function persistStage(options: {
  job: ProfileJob; store: any; update(patch: Partial<ProfileJob>): void
}, status: ProfileJobStatus, phase: string, persistence: 'memory' | 'checkpoint' = 'checkpoint') {
  const patch = { status, phase, updatedAt: new Date().toISOString() }
  if (persistence === 'checkpoint') await options.store.update(options.job.jobId, patch)
  options.update(patch)
}
