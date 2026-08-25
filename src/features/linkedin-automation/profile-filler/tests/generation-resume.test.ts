const assert = require('node:assert/strict')
const { generatedDocument, emptyFacts } = require('./generation-fixture.ts') as
  typeof import('./generation-fixture.ts')
const { createProfileFillerService } = require('../service.ts') as any
const { createLinkedInOperationGate } = require('../../../web-console/backend/linkedin-operation-gate.ts') as any

const turn = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(service: any, id: string, status: string) {
  for (let index = 0; index < 100; index += 1) {
    const job = await service.get(id)
    if (job?.status === status) return job
    await turn()
  }
  throw new Error(`Job did not reach ${status}`)
}

async function run() {
  const records = new Map<string, any>(); let limited = true; let extracted = 0; let generated = 0
  const account = { platformAccountId: 7, clientName: 'Student', dolphinProfileId: 9,
    linkedinUrl: 'https://www.linkedin.com/in/student/', unipileAccountId: 'acc-1',
    unipileAccountStatus: 'running', verifiedProviderId: 'provider-1',
    lastVerifiedAt: '2026-08-21T00:00:00.000Z' }
  const store = { async create(job: any) { records.set(job.jobId, structuredClone(job)) },
    async update(id: string, patch: any) { Object.assign(records.get(id), structuredClone(patch)) },
    async get(id: string) { return records.get(id) }, async list() { return [...records.values()] } }
  const service = createProfileFillerService({ store, gate: createLinkedInOperationGate(),
    repository: { async listAccounts() { return [account] } },
    generationRepository: { async getGenerationContext() {
      return { account, cvUrl: 'private', cvRevision: 'cv-1' }
    } },
    client: { async getAccount() { return { provider: 'linkedin', status: 'running',
      is_locked: false, user_id: 'provider-1' } }, async getOwnProfile() { return {
      public_identifier: 'student', provider_id: 'provider-1', profile_url: account.linkedinUrl,
      specifics: { experience: [], education: [], skills: [] }
    } }, async searchParameters() {
      if (limited) throw Object.assign(new Error('limited'), {
        code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 0 }
      })
      return ['Backend Engineer', 'Go Engineer', 'Software Engineer', 'Platform Engineer',
        'API Engineer'].map((name, index) => ({ id: `role-${index}`, name }))
    } },
    generationRuntime: { config: { model: 'mock-model' }, catalogRetry: {
      sleep: async () => undefined, random: () => 0.5
    }, loadProfile: async () => ({ proxy: { ip: '203.0.113.5' } }),
    resolveCountry: async () => 'Poland', loadCv: async () => ({ bytes: Buffer.from('cv'),
      fileName: 'cv.pdf', mimeType: 'application/pdf', revision: 'drive-1' }),
    generator: { extractFacts: async () => { extracted += 1; return emptyFacts },
      generateProfile: async () => { generated += 1; return generatedDocument() } } } })
  const [started, duplicate] = await Promise.all([
    service.startGeneration(7), service.startGeneration(7)
  ])
  assert.equal(duplicate.jobId, started.jobId)
  const waiting = await waitFor(service, started.jobId, 'waiting_retry')
  assert.equal(waiting.retry.attempt, 3)
  assert.equal(JSON.stringify(waiting).includes('profile'), false)
  limited = false
  await service.resume(started.jobId)
  const ready = await waitFor(service, started.jobId, 'preview_ready')
  assert.equal(ready.status, 'preview_ready')
  assert.equal(extracted, 1); assert.equal(generated, 1)
  assert.equal(records.get(started.jobId).checkpoint, null)
}

run().then(() => console.log('generation resume tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
