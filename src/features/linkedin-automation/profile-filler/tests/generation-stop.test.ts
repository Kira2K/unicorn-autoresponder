import assert from 'node:assert/strict'
import { preparationCall, preparationWait, releasePreparation, GENERATION_STOPPED } from '../generation/cancellation.ts'
import { stopProfileGeneration } from '../stop-generation.ts'
import { interruptedJobPatch } from '../job-state.ts'
import type { ProfileJob } from '../job-types.ts'

export async function testGenerationStop() {
  const job: ProfileJob = { jobId: 'stop', platformAccountId: 7, clientName: 'Mock',
    status: 'generating_cv', phase: 'extracting_cv_facts', createdAt: '', updatedAt: '' }
  const jobs = new Map([[job.jobId, job]])
  const patches: Partial<ProfileJob>[] = []
  const store = { async get() { return job }, async update(_id: string, patch: Partial<ProfileJob>) {
    patches.push(structuredClone(patch))
  } }
  let finish!: () => void
  let calls = 0
  const active = preparationCall(job, async () => {
    calls += 1
    await new Promise<void>(resolve => { finish = resolve })
  })
  const rejected = assert.rejects(active, { code: GENERATION_STOPPED })
  const stopped = await stopProfileGeneration({ jobId: job.jobId, jobs, store })
  assert.equal(stopped.phase, 'stopping_generation')
  await stopProfileGeneration({ jobId: job.jobId, jobs, store })
  assert.equal(patches.length, 1, 'duplicate Stop is idempotent')
  await assert.rejects(preparationCall(job, () => { calls += 1 }), { code: GENERATION_STOPPED })
  finish()
  await rejected
  assert.equal(calls, 1, 'in-flight request settles; no next request starts')
  assert.equal(interruptedJobPatch(job)?.phase, 'generation_stopped', 'restart cannot resume a stopped checkpoint')
  releasePreparation(job)

  const waiting: ProfileJob = { ...job, jobId: 'waiting', phase: 'retrying_job_titles',
    status: 'retrying', errorCode: undefined }
  jobs.set(waiting.jobId, waiting)
  const timer = preparationWait(waiting, 60_000)
  const timerStopped = assert.rejects(timer, { code: GENERATION_STOPPED })
  const started = Date.now()
  await stopProfileGeneration({ jobId: waiting.jobId, jobs, store })
  await timerStopped
  assert(Date.now() - started < 1000, 'Stop interrupts a normal retry timer')
  releasePreparation(waiting)

  const stored: ProfileJob = { ...job, jobId: 'saved', status: 'waiting_retry',
    phase: 'waiting_unipile_retry', errorCode: undefined }
  const saved = await stopProfileGeneration({ jobId: stored.jobId, jobs,
    store: { ...store, async get() { return stored } } })
  assert.equal(saved.status, 'failed')
  assert.equal(saved.phase, 'generation_stopped')
  for (const status of ['running', 'verifying', 'preview_ready'] as const) {
    const writing: ProfileJob = { ...job, jobId: status, status, phase: status, errorCode: undefined }
    jobs.set(writing.jobId, writing)
    await assert.rejects(stopProfileGeneration({ jobId: writing.jobId, jobs, store }),
      { code: 'profile_generation_stop_unavailable' })
    assert.equal(writing.status, status, 'Stop cannot cancel LinkedIn filling or its read-back')
  }
  const broken: ProfileJob = { ...job, jobId: 'broken', phase: 'generating_profile', errorCode: undefined }
  jobs.set(broken.jobId, broken)
  await assert.rejects(stopProfileGeneration({ jobId: broken.jobId, jobs, store: {
    ...store, async update() { throw new Error('mock storage unavailable') }
  } }), /mock storage/)
  await assert.rejects(preparationCall(broken, () => { calls += 1 }), { code: GENERATION_STOPPED })
  assert.equal(calls, 1, 'failed Stop persistence still blocks local requests')
  const beforeRetry = patches.length
  await stopProfileGeneration({ jobId: broken.jobId, jobs, store })
  assert.equal(patches.length, beforeRetry + 1, 'failed Stop persistence may be retried without resuming work')
  releasePreparation(broken)
}
