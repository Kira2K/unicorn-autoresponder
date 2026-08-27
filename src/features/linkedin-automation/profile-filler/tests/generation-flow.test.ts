const assert = require('node:assert/strict')
const { createProfileFillerService } = require('../service.ts') as any
const { emptyFacts, generatedDocument } = require('./generation-fixture.ts') as
  typeof import('./generation-fixture.ts')

const turn = () => new Promise(resolve => setImmediate(resolve))

async function run() {
  const records = new Map<string, any>(); const events: any[] = []; const releases: string[] = []
  let contextReads = 0; let cvDownloads = 0; const extractedMimes: string[] = []
  const account = { platformAccountId: 7, clientId: 8, clientName: 'Student',
    linkedinUrl: 'https://www.linkedin.com/in/student/', dolphinProfileId: 9,
    unipileAccountId: 'acc-1', unipileAccountStatus: 'running',
    verifiedProviderId: 'provider-1', lastVerifiedAt: '2026-08-21T00:00:00.000Z' }
  const store = {
    async create(job: any) { records.set(job.jobId, structuredClone(job)) },
    async update(id: string, patch: any) {
      const record = records.get(id)
      assert(record, `missing record ${id}`); Object.assign(record, structuredClone(patch))
    },
    async get(id: string) { return records.get(id) }, async list() { return [...records.values()] }
  }
  const service = createProfileFillerService({
    repository: { async listAccounts() { return [account] } },
    generationRepository: { async getGenerationContext() { contextReads += 1
      return { account, cvUrl: 'secret-drive-url', cvRevision: 'cv-1' }
    } },
    client: { async getAccount() { return { provider: 'linkedin', status: 'running',
      is_locked: false, user_id: 'provider-1' } }, async getOwnProfile() { return {
      public_identifier: 'student', provider_id: 'provider-1', name: 'Student',
      profile_url: account.linkedinUrl, specifics: { experience: [], education: [], skills: [] }
    } }, async searchParameters(_id: string, _type: string, keywords: string) {
      return [{ id: keywords, name: keywords }]
    } },
    store, gate: { acquire(kind: string) { return () => releases.push(kind) } },
    generationRuntime: { config: { model: 'mock-model' },
      loadProfile: async () => ({ proxy: { ip: '203.0.113.5' } }),
      resolveCountry: async () => 'Poland', loadCv: async () => { cvDownloads += 1; return {
        bytes: Buffer.from('mock'), fileName: 'cv.pdf', mimeType: 'application/pdf',
        revision: 'drive-1' } },
      generator: { extractFacts: async (cv: any) => { extractedMimes.push(cv.mimeType); return emptyFacts },
        generateProfile: async () => generatedDocument() } },
    executorOptions: { logger: { event: (...args: any[]) => events.push(args) } }
  })
  const started = await service.startGeneration(7)
  let result
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await service.get(started.jobId)
    if (result?.status === 'preview_ready') break
    await turn()
  }
  assert.equal(result.status, 'preview_ready', JSON.stringify({ result, events }))
  assert.equal(result.preview.generation.model, 'mock-model')
  assert.equal(result.preview.generation.proxyCountry, 'Poland')
  assert.equal(JSON.stringify([...records.values()]).includes('secret-drive-url'), false)
  assert(events.some(event => event[0] === 'cv_fact_extraction'))
  const uploaded = await service.startGeneration(7, {
    bytes: Buffer.from('%PDF-private-cv'), mimeType: 'application/pdf'
  })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    result = await service.get(uploaded.jobId)
    if (result?.status === 'preview_ready') break
    await turn()
  }
  assert.equal(result.status, 'preview_ready')
  assert.match(result.preview.generation.cvRevision, /^upload:[a-f0-9]{64}$/)
  assert.equal(contextReads, 1); assert.equal(cvDownloads, 1)
  assert.deepEqual(extractedMimes, ['application/pdf', 'application/pdf'])
  assert.equal(JSON.stringify([...records.values()]).includes('private-cv'), false)
  assert(events.some(event => event[0] === 'cv_upload_validate'))
  assert(events.some(event => event[0] === 'cv_upload_select'))
  assert.deepEqual(releases, ['profile_generate', 'profile_generate'])
}

run().then(() => console.log('profile generation flow tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
