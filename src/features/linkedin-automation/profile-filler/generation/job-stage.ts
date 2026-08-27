import type { ProfileJob, ProfileJobStatus } from '../job-types.ts'

export async function persistStage(options: {
  job: ProfileJob; store: any; update(patch: Partial<ProfileJob>): void
}, status: ProfileJobStatus, phase: string) {
  const patch = { status, phase, updatedAt: new Date().toISOString() }
  options.update(patch)
  await options.store.update(options.job.jobId, patch)
}
