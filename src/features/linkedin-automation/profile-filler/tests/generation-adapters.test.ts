const assert: typeof import('node:assert/strict') = require('node:assert/strict')
const { createOpenAiHttp } = require('../generation/openai-http.ts') as typeof import('../generation/openai-http.ts')
const { resolveProxyCountry } = require('../generation/proxy-country.ts') as typeof import('../generation/proxy-country.ts')
const { assertDriveCredentials, generationConfig } = require('../generation/config.ts') as typeof import('../generation/config.ts')
const { responseText } = require('../generation/openai-response.ts') as typeof import('../generation/openai-response.ts')
const { DOCX_MIME, normalizeUploadedCv, PDF_MIME } = require('../generation/uploaded-cv.ts') as typeof import('../generation/uploaded-cv.ts')
const { getDolphinProfileWithProxyLastCheck } = require('../../../../integrations/dolphin/profile-proxy.ts')

async function run() {
  const config = generationConfig({ OPENAI_LINKEDIN_PROFILE_API_KEY: 'profile-key',
    OPENAI_LINKEDIN_PROFILE_MODEL: 'model' } as any)
  assert.equal(config.apiKey, 'profile-key')
  assert.equal(config.credentialsFile, '')
  assert.throws(() => assertDriveCredentials(''),
    { code: 'profile_cv_credentials_missing' })
  assert.throws(() => generationConfig({ OPENAI_LINKEDIN_PROFILE_MODEL: 'model',
    GOOGLE_APPLICATION_CREDENTIALS: 'drive.json' } as any), { code: 'openai_api_key_missing' })
  assert.throws(() => generationConfig({ OPENAI_API_KEY_ZERO: 'must-not-be-used',
    OPENAI_LINKEDIN_PROFILE_MODEL: 'model' } as any), { code: 'openai_api_key_missing' })
  assert.throws(() => generationConfig({ OPENAI_API_KEY: 'must-not-be-used',
    OPENAI_LINKEDIN_PROFILE_MODEL: 'model' } as any), { code: 'openai_api_key_missing' })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Country lookup must not use the network') }
  try {
    // Age, status and IP do not trigger another check: another program maintains them.
    assert.equal(await resolveProxyCountry({ ip: '198.51.100.2', lastCheck: {
      country: 'GE', createdAt: '2020-01-01', ip: '203.0.113.8', status: 0
    } }), 'Georgia')
    assert.equal(await resolveProxyCountry({ lastCheck: { country: ' pl ' } }), 'Poland')
    assert.equal(await resolveProxyCountry({ lastCheck: { country: 'US' } }), 'United States')
    for (const country of [undefined, '', 'XX', 'ZZ', '123', 'Georgia']) {
      await assert.rejects(resolveProxyCountry({ country: 'GE', lastCheck: { country } }),
        { code: 'profile_proxy_country_unavailable' })
    }
    await assert.rejects(resolveProxyCountry(undefined), { code: 'profile_proxy_country_unavailable' })
    await assert.rejects(resolveProxyCountry({ lastCheck: { country: 'ru' } }),
      { code: 'profile_proxy_country_disallowed' })

    let calls = 0
    let savedCountry = 'GE'
    const request = async (path: string, options: any) => {
      calls += 1
      assert.equal(path, '/proxy')
      assert.deepEqual(options, { query: { 'ids[]': '17' } })
      return { data: [{ id: 18, lastCheck: { country: 'RU' } },
        { id: '17', lastCheck: { country: savedCountry, createdAt: '2020-01-01' } }] }
    }
    const getProfile = async (id: number) => {
      assert.equal(id, 9)
      return { id, proxyId: 17, proxy: { id: 17, host: 'proxy.test', ip: '203.0.113.8' } }
    }
    const loaded = await getDolphinProfileWithProxyLastCheck(9, { getProfile, request })
    assert.equal(await resolveProxyCountry(loaded.proxy), 'Georgia')
    savedCountry = 'PL'
    const changed = await getDolphinProfileWithProxyLastCheck(9, {
      getProfile: async () => ({ proxyId: 17 }), request
    })
    assert.equal(await resolveProxyCountry(changed.proxy), 'Poland', 'no local country cache')
    assert.equal(calls, 2, 'one saved-check read for each preparation')
    const missing = await getDolphinProfileWithProxyLastCheck(9, {
      getProfile, request: async () => ({ data: [{ id: 18, lastCheck: { country: 'GE' } }] })
    })
    await assert.rejects(resolveProxyCountry(missing.proxy), { code: 'profile_proxy_country_unavailable' })
    const absent = await getDolphinProfileWithProxyLastCheck(9, {
      getProfile: async () => ({}), request: async () => { throw new Error('Unexpected request') }
    })
    await assert.rejects(resolveProxyCountry(absent.proxy), { code: 'profile_proxy_country_unavailable' })
    const failure = new Error('Dolphin unavailable')
    await assert.rejects(getDolphinProfileWithProxyLastCheck(9, {
      getProfile, request: async () => { throw failure }
    }), (error: unknown) => error === failure)
  } finally {
    globalThis.fetch = originalFetch
  }

  let captured: any
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text',
      text: '{"ok":true}' }] }] }), { status: 200 })
  }) as typeof fetch
  const client = createOpenAiHttp({ apiKey: 'secret', model: 'test-model', timeoutMs: 1000,
    maxOutputTokens: 500, fetchImpl, baseUrl: 'https://openai.test/v1' })
  assert.deepEqual(await client.respond('input', 'safe_schema', { type: 'object' }, 'rules'),
    { ok: true })
  assert.equal(captured.store, false)
  assert.deepEqual(captured.tools, [])
  assert.equal(captured.text.format.strict, true)
  assert.equal(captured.text.format.name, 'safe_schema')
  assert.equal(captured.model, 'test-model')
  let limitedCalls = 0; const retryWaits: number[] = []
  const limited = createOpenAiHttp({ apiKey: 'secret', model: 'test', timeoutMs: 100,
    maxOutputTokens: 10, baseUrl: 'https://openai.test/v1',
    retrySleep: async milliseconds => { retryWaits.push(milliseconds) }, retryRandom: () => 0.5,
    fetchImpl: (async () => { limitedCalls += 1
      return new Response('{}', { status: 429, headers: { 'retry-after': '0' } })
    }) as typeof fetch })
  await assert.rejects(limited.respond('x', 'x', {}, 'x'), { code: 'openai_rate_limited' })
  assert.equal(limitedCalls, 3); assert.deepEqual(retryWaits, [0, 0])
  assert.throws(() => responseText({ status: 'incomplete' }),
    { code: 'openai_response_incomplete' })
  assert.throws(() => responseText({ output: [{ content: [{ type: 'refusal' }] }] }),
    { code: 'openai_response_refused' })
  const pdf = normalizeUploadedCv({ bytes: Buffer.from('%PDF-safe'), mimeType: PDF_MIME })
  const docx = normalizeUploadedCv({ bytes: Buffer.from([0x50, 0x4b, 3, 4]),
    mimeType: DOCX_MIME })
  assert.equal(pdf.fileName, 'uploaded-en-cv.pdf')
  assert.equal(docx.fileName, 'uploaded-en-cv.docx')
  assert.match(pdf.revision, /^upload:[a-f0-9]{64}$/)
  assert.equal(pdf.revision.includes(pdf.fileName), false)
  assert.throws(() => normalizeUploadedCv({ bytes: Buffer.alloc(0), mimeType: PDF_MIME }),
    { code: 'profile_cv_empty' })
  assert.throws(() => normalizeUploadedCv({ bytes: Buffer.from('bad'), mimeType: PDF_MIME }),
    { code: 'profile_cv_content_invalid' })
  assert.throws(() => normalizeUploadedCv({ bytes: Buffer.from('%PDF-safe'),
    mimeType: 'text/plain' }), { code: 'profile_cv_format_unsupported' })
  assert.throws(() => normalizeUploadedCv({ bytes: Buffer.from('%PDF-safe'),
    mimeType: PDF_MIME }, 4), { code: 'profile_cv_too_large' })
}

run().then(() => console.log('profile generation adapter tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
