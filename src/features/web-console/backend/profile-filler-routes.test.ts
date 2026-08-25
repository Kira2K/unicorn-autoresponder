const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as any
const { failure } = require('./profile-filler-routes.ts') as any

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  return String(response.headers.get('set-cookie')).split(';')[0]
}

async function run() {
  assert.deepEqual(failure({ code: 'noco_rate_limited' }), { status: 429, body: {
    error: 'noco_rate_limited', message: 'NocoDB is busy. Wait 30 seconds and retry.'
  } })
  assert.equal(failure({ response: { status: 429 } }).body.error, 'noco_rate_limited')
  assert.equal(failure({ code: 'linkedin_operation_active' }).body.message,
    '[linkedin_operation_active] Another LinkedIn operation is running. Wait for it to finish and retry.')
  assert.equal(failure({ code: 'profile_job_not_ready' }).body.message,
    '[profile_job_not_ready] This preview can no longer be applied. Build a fresh preview.')
  assert.equal(failure({ code: 'profile_preview_has_blocking_issues' }).status, 409)
  const calls: any[] = []
  const job = { jobId: 'job-1', status: 'preview_ready', planHash: 'safe-hash' }
  const app = createWebConsoleApp({
    useMockData: true,
    profileFiller: {
      async searchParameters(id: number, type: string, keywords: string) {
        calls.push(['search', id, type, keywords]); return { type, items: [{ name: 'QA Engineer' }] }
      },
      async startGeneration(id: number, upload?: any) {
        calls.push(['generate', id, upload && { mimeType: upload.mimeType,
          size: upload.bytes.length }]); return job
      },
      async startPreview(id: number, body: any) { calls.push(['preview', id, body]); return job },
      async apply(id: string, hash: string) { calls.push(['apply', id, hash]); return job },
      async resume(id: string) { calls.push(['resume', id]); return job },
      async rollback(id: string) { calls.push(['rollback', id]); return job },
      async get(id: string) { return id === job.jobId ? job : undefined },
      async list() { return [job] }
    }
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  try {
    const previewUrl = `${base}/api/admin/linkedin/accounts/7/profile-previews`
    const generationUrl = `${base}/api/admin/linkedin/accounts/7/profile-generations`
    const parametersUrl = `${base}/api/admin/linkedin/accounts/7/profile-parameters?type=JOB_TITLE&keywords=QA`
    assert.equal((await fetch(previewUrl, { method: 'POST' })).status, 401)
    assert.equal((await fetch(generationUrl, { method: 'POST' })).status, 401)
    assert.equal((await fetch(parametersUrl)).status, 401)
    const provider = await login(base, 'Nariman', 'Nariman')
    assert.equal((await fetch(previewUrl, { method: 'POST', headers: {
      Cookie: provider, 'Content-Type': 'application/json'
    }, body: '{}' })).status, 403)
    assert.equal((await fetch(generationUrl, { method: 'POST', headers: {
      Cookie: provider
    } })).status, 403)
    const admin = await login(base, 'unicornveryevil@gmail.com', '101010')
    const headers = { Cookie: admin, 'Content-Type': 'application/json' }
    const analysis = await fetch(`${base}/api/admin/linkedin/profile-analysis`, {
      method: 'POST', headers, body: JSON.stringify({ headline: 'Engineer' })
    })
    assert.equal(analysis.status, 200)
    assert.equal((await analysis.json()).document.profile.headline, 'Engineer')
    assert.equal((await fetch(previewUrl, { method: 'POST', headers,
      body: JSON.stringify({ schema_version: 1, profile: {} }) })).status, 202)
    assert.equal((await fetch(generationUrl, { method: 'POST', headers })).status, 202)
    assert.equal((await fetch(generationUrl, { method: 'POST', headers: {
      Cookie: admin, 'Content-Type': 'application/pdf'
    }, body: Buffer.from('%PDF-route') })).status, 202)
    const unsupported = await fetch(generationUrl, { method: 'POST', headers: {
      Cookie: admin, 'Content-Type': 'text/plain'
    }, body: 'not-a-cv' })
    assert.equal(unsupported.status, 415)
    assert.equal((await unsupported.json()).error, 'profile_cv_format_unsupported')
    assert.equal((await fetch(`${base}/api/admin/linkedin/profile-jobs`, { headers })).status, 200)
    assert.equal((await fetch(`${base}/api/admin/linkedin/profile-jobs/job-1`, { headers })).status, 200)
    const parameters = await fetch(parametersUrl, { headers })
    assert.equal(parameters.status, 200)
    assert.deepEqual((await parameters.json()).items, [{ name: 'QA Engineer' }])
    assert.equal((await fetch(`${base}/api/admin/linkedin/profile-jobs/job-1/apply`, {
      method: 'POST', headers, body: JSON.stringify({ planHash: 'safe-hash' })
    })).status, 202)
    assert.equal((await fetch(`${base}/api/admin/linkedin/profile-jobs/job-1/resume`, {
      method: 'POST', headers
    })).status, 202)
    assert.equal((await fetch(`${base}/api/admin/linkedin/profile-jobs/job-1/rollback`, {
      method: 'POST', headers
    })).status, 202)
    assert.deepEqual(calls.map(value => value[0]),
      ['preview', 'generate', 'generate', 'search', 'apply', 'resume', 'rollback'])
    assert.deepEqual(calls[2][2], { mimeType: 'application/pdf', size: 10 })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) =>
      error ? reject(error) : resolve()))
  }
}

run().then(() => console.log('profile filler route tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
