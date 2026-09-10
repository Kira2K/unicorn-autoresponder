const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { stopProfileGeneration } = require('../stop-generation.ts') as typeof import('../stop-generation.ts')
const { GENERATION_STOPPED } = require('../generation/cancellation.ts') as typeof import('../generation/cancellation.ts')
import type { ProfileJob } from '../job-types.ts'
const { runGeneration } = require('../generation/run-generation.ts') as {
  runGeneration(options: Record<string, unknown>): Promise<void>
}
const { createGenerationRuntime } = require('../generation/runtime.ts') as {
  createGenerationRuntime(options: Record<string, unknown>, logger: { event(): void }, job: ProfileJob): {
    generator: { extractFacts(cv: Record<string, unknown>): Promise<unknown> }
  }
}

async function testGenerationRunStop() {
  const job: ProfileJob = { jobId: 'generation', platformAccountId: 7, clientName: 'Mock',
    status: 'generating_cv', phase: 'extracting_cv_facts', createdAt: '', updatedAt: '' }
  const jobs = new Map([[job.jobId, job]])
  const patches: Partial<ProfileJob>[] = []
  const store = { async get() { return job }, async update(_id: string, patch: Partial<ProfileJob>) {
    patches.push(structuredClone(patch))
  } }
  let generated = 0, released = 0
  let finish!: () => void
  const active = runGeneration({ job, jobs, store, account: { dolphinProfileId: 1 },
    cv: { bytes: Buffer.from('mock'), revision: 'mock' },
    update: (patch: Partial<ProfileJob>) => Object.assign(job, patch), release: () => { released += 1 },
    logger: { event() {} }, client: {}, runtime: {
      config: { model: 'mock' }, loadProfile: async () => ({}), resolveCountry: async () => 'Poland',
      generator: { extractFacts: async () => {
        await new Promise<void>(resolve => { finish = resolve })
        return {}
      }, generateProfile: async () => { generated += 1; return {} } }
    } })
  for (let i = 0; i < 30 && !finish; i += 1) await new Promise(resolve => setImmediate(resolve))
  assert(finish, 'mock extraction started')
  await stopProfileGeneration({ jobId: job.jobId, jobs, store })
  assert.equal(released, 0, 'account gate stays held until the in-flight call settles')
  finish()
  await active
  assert.equal(generated, 0)
  assert.equal(released, 1)
  assert.equal(job.phase, 'generation_stopped')
  assert.equal(job.errorCode, GENERATION_STOPPED)
  assert.equal(patches.at(-1)?.phase, 'generation_stopped')
  assert(!patches.some(patch => patch.status === 'preview_ready'))

  // A stopped OpenAI flow must not start another provider call.
  let fetches = 0
  const runtime = createGenerationRuntime({ config: { model: 'mock', apiKey: 'mock',
    openAiTimeoutMs: 1000, maxOutputTokens: 100 }, openAiFetch: async () => {
      fetches += 1
      throw new Error('unexpected request')
    } }, { event() {} }, job)
  await assert.rejects(runtime.generator.extractFacts({ bytes: Buffer.from('mock'), fileName: 'cv.pdf',
    mimeType: 'application/pdf', revision: 'mock' }), { code: GENERATION_STOPPED })
  assert.equal(fetches, 0)
  const { createProfileFillerService } = require('../service.ts')
  const stored: ProfileJob = { ...job, status: 'waiting_retry', phase: 'stopping_generation' }
  const restarted = createProfileFillerService({ client: {}, executorOptions: { logger: { event() {} } },
    store: { async get() { return stored }, async listActive() { return [stored] },
      async update(_id: string, patch: Partial<ProfileJob>) { Object.assign(stored, patch) } },
    repository: { async getAccount() { throw new Error('mock new generation requested') } } })
  await assert.rejects(restarted.resume(stored.jobId), { code: GENERATION_STOPPED })
  await assert.rejects(restarted.startGeneration(7), /mock new generation requested/)
  assert.equal(stored.phase, 'generation_stopped', 'stopped checkpoint frees the next manual generation')
}
module.exports = { testGenerationRunStop }
