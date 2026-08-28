const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as any

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return String(response.headers.get('set-cookie')).split(';')[0]
}

async function run() {
  const calls: any[] = []
  const job = { runId: 'connections-1', platformAccountId: 103, status: 'succeeded' }
  const service = {
    async list() { return [job] },
    async get(id: string) { return id === job.runId ? job : undefined },
    async history(id: number) { return [{ platformAccountId: id, personId: 'person' }] },
    async readiness(id: number) { return { platformAccountId: id, ready: true } },
    async stacks() { return [{ id: 7, name: 'PYTHON' }] },
    async saveStack(id: number, stackId: number) {
      calls.push(['stack', id, stackId]); return { platformAccountId: id, stackId }
    },
    async start(id: number, input: any) {
      calls.push(['start', id, input.safeRecruiterOnly]); return job
    },
    async stopRun(id: string) { calls.push(['stop', id]); return job }
  }
  const app = createWebConsoleApp({ useMockData: true, connectionInviter: service })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  try {
    const runs = `${base}/api/admin/linkedin/connection-runs`
    assert.equal((await fetch(runs)).status, 401)
    const provider = await login(base, 'Nariman', 'Nariman')
    assert.equal((await fetch(runs, { headers: { Cookie: provider } })).status, 403)
    const admin = await login(base, 'unicornveryevil@gmail.com', '101010')
    const headers = { Cookie: admin, 'Content-Type': 'application/json' }
    assert.equal((await fetch(runs, { headers })).status, 200)
    assert.equal((await fetch(`${runs}/connections-1`, { headers })).status, 200)
    assert.equal((await fetch(`${runs}/connections-1/stop`, { method: 'POST', headers })).status, 202)
    assert.equal((await fetch(`${base}/api/admin/linkedin/connection-stacks`, { headers })).status, 200)
    const account = `${base}/api/admin/linkedin/accounts/103`
    assert.equal((await fetch(`${account}/connection-readiness`, { headers })).status, 200)
    assert.equal((await fetch(`${account}/connection-history`, { headers })).status, 200)
    assert.equal((await fetch(`${account}/connection-stack`, { method: 'PUT', headers,
      body: JSON.stringify({ stackId: 7 }) })).status, 200)
    assert.equal((await fetch(`${account}/connection-runs`, { method: 'POST', headers,
      body: JSON.stringify({ safeRecruiterOnly: true }) })).status, 202)
    assert.deepEqual(calls, [['stop', 'connections-1'], ['stack', 103, 7], ['start', 103, true]])
  } finally { await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => error ? reject(error) : resolve())) }
}

run().then(() => console.log('connection inviter route tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
