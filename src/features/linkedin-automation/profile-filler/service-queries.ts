const { publicProfileJob } = require('./job-types.ts') as typeof import('./job-types.ts')
const { recoverInterruptedJob } = require('./job-state.ts') as {
  recoverInterruptedJob(store: any, job: ProfileJob): Promise<ProfileJob>
}
type ProfileJob = import('./job-types.ts').ProfileJob

async function getPublicJob(store: any, jobs: Map<string, ProfileJob>, jobId: string) {
  const active = jobs.get(jobId)
  const job = active ?? await store.get(jobId)
  if (!job) return undefined
  if (!active) await recoverInterruptedJob(store, job)
  return publicProfileJob(job)
}

async function listPublicJobs(store: any, jobs: Map<string, ProfileJob>) {
  return await Promise.all((await store.list()).map(async (job: ProfileJob) => {
    const active = jobs.get(job.jobId)
    return publicProfileJob(active ?? await recoverInterruptedJob(store, job))
  }))
}

module.exports = { getPublicJob, listPublicJobs }
