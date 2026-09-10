import type { ProfileJob } from './job-types.ts'
import type { MutationStore } from './mutation-persistence.ts'
import { codedError } from './errors.ts'
import { publicProfileJob } from './job-types.ts'
import { cancelPreparation, GENERATION_STOPPED, PREPARATION_STATUSES } from './generation/cancellation.ts'
const saves = new WeakMap<ProfileJob, Promise<unknown>>()

export async function stopProfileGeneration(options: {
  jobId: string; jobs: Map<string, ProfileJob>
  store: MutationStore & { get(id: string): Promise<ProfileJob | undefined> }
}) {
  const { jobId, jobs, store } = options
  const job = jobs.get(jobId) ?? await store.get(jobId)
  if (!job) throw codedError('profile_job_not_found', 'Задание не найдено.')
  const previous = saves.get(job)
  if (previous) { await previous; return publicProfileJob(job) }
  if (job.phase === 'generation_stopped' && !jobs.has(jobId)) return publicProfileJob(job)
  const stopping = job.errorCode === GENERATION_STOPPED &&
    ['generation_stopped', 'stopping_generation'].includes(job.phase)
  if (!stopping && !PREPARATION_STATUSES.has(job.status)) {
    throw codedError('profile_generation_stop_unavailable',
      'Можно остановить только подготовку Preview, не заполнение LinkedIn.')
  }
  const active = cancelPreparation(job)
  const now = new Date().toISOString()
  const patch: Partial<ProfileJob> = { errorCode: GENERATION_STOPPED, updatedAt: now,
    phase: active ? 'stopping_generation' : 'generation_stopped',
    ...(!active ? { status: 'failed', finishedAt: now } : {}) }
  Object.assign(job, patch)
  jobs.set(jobId, job)
  const saved = store.update(jobId, patch)
  saves.set(job, saved)
  try { await saved }
  catch (error) { saves.delete(job); throw error }
  return publicProfileJob(job)
}
