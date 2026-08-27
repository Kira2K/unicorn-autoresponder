import assert from 'node:assert/strict'
import { createOpenAiHttp } from '../generation/openai-http.ts'
import { clearProxyCountryCache, resolveProxyCountry } from '../generation/proxy-country.ts'
import { assertDriveCredentials, generationConfig } from '../generation/config.ts'
import { responseText } from '../generation/openai-response.ts'
import { DOCX_MIME, normalizeUploadedCv, PDF_MIME } from '../generation/uploaded-cv.ts'

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
  clearProxyCountryCache()
  let geoCalls = 0
  const country = await resolveProxyCountry({ ip: '203.0.113.8' }, {
    baseUrl: 'https://geo.test', timeoutMs: 100,
    fetchImpl: (async () => { geoCalls += 1; return new Response(JSON.stringify({
      success: true, country: 'Poland', country_code: 'PL'
    }), { status: 200 }) }) as typeof fetch
  })
  assert.equal(country, 'Poland'); assert.equal(geoCalls, 1)
  await assert.rejects(resolveProxyCountry({ host: 'proxy.test' }, {
    baseUrl: 'x', timeoutMs: 10
  }), { code: 'profile_proxy_ip_missing' })
  clearProxyCountryCache()
  await assert.rejects(resolveProxyCountry({ ip: '198.51.100.2' }, {
    baseUrl: 'https://geo.test', timeoutMs: 100,
    fetchImpl: (async () => new Response(JSON.stringify({ country: 'Russia',
      country_code: 'RU' }), { status: 200 })) as typeof fetch
  }), { code: 'profile_proxy_country_disallowed' })

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
