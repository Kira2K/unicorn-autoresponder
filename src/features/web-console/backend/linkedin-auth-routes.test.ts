const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as {
  createWebConsoleApp(options?: any): import('express').Express
}
const { routeFailure } = require('./linkedin-auth-routes.ts') as {
  routeFailure(error: any): { status: number; body: Record<string, string> }
}

async function run(): Promise<void> {
  const limited = routeFailure({ response: { status: 429 } })
  assert.equal(limited.status, 429)
  assert.equal(limited.body.error, 'noco_rate_limited')
  assert.equal(routeFailure({ code: 'noco_timeout' }).status, 503)
  const calls: any[] = []
  const updates: any[] = []
  const history = [{ runId: 'old-run', status: 'succeeded' }]
  const activeRun = {
    runId: 'run-1', platformAccountId: 103, clientName: 'Test', action: 'check',
    status: 'running', stage: 'queued', stageStatus: 'started',
    startedAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T10:00:00.000Z'
  }
  const app = createWebConsoleApp({
    useMockData: true,
    linkedinAuthRuns: {
      async listAccounts() { return [{ platformAccountId: 103, clientName: 'Test' }] },
      async listHistory() { return history },
      async updateAccount(id: number, input: any) {
        updates.push({ id, input })
        return { platformAccountId: id, linkedinUrl: input.linkedinUrl }
      },
      async start(id: number, action: string) { calls.push({ id, action }); return activeRun },
      get(id: string) { return id === activeRun.runId ? activeRun : undefined }
    }
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  try {
    assert.equal((await fetch(`${base}/api/admin/linkedin/accounts`)).status, 401)
    const providerLogin = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Nariman', password: 'Nariman' })
    })
    const providerCookie = String(providerLogin.headers.get('set-cookie')).split(';')[0]
    assert.equal((await fetch(`${base}/api/admin/linkedin/accounts`, {
      headers: { Cookie: providerCookie }
    })).status, 403)
    assert.equal((await fetch(`${base}/api/admin/linkedin/accounts/103`, {
      method: 'PATCH', headers: { Cookie: providerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedinUrl: 'https://www.linkedin.com/in/test/' })
    })).status, 403)
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unicornveryevil@gmail.com', password: '101010' })
    })
    const cookie = String(login.headers.get('set-cookie')).split(';')[0]
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
    const accounts = await fetch(`${base}/api/admin/linkedin/accounts`, { headers })
    assert.equal(accounts.status, 200)
    const runs = await fetch(`${base}/api/admin/linkedin/runs`, { headers })
    assert.deepEqual((await runs.json()).runs, history)
    const updated = await fetch(`${base}/api/admin/linkedin/accounts/103`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ linkedinUrl: 'https://www.linkedin.com/in/test/' })
    })
    assert.equal(updated.status, 200)
    assert.deepEqual(updates, [{ id: 103, input: { linkedinUrl: 'https://www.linkedin.com/in/test/' } }])
    const started = await fetch(`${base}/api/admin/linkedin/accounts/103/runs`, {
      method: 'POST', headers, body: JSON.stringify({ action: 'check' })
    })
    assert.equal(started.status, 202)
    assert.deepEqual(calls, [{ id: 103, action: 'check' }])
    assert.equal((await fetch(`${base}/api/admin/linkedin/runs/run-1`, { headers })).status, 200)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

run()
  .then(() => console.log('linkedin auth route tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
