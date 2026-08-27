const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as any

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return String(response.headers.get('set-cookie')).split(';')[0]
}

async function run() {
  const calls: any[] = []
  const job = { jobId: 'comments-1', platformAccountId: 103, status: 'waiting' }
  const app = createWebConsoleApp({ useMockData: true, commentMonitor: {
    async enable(id: number) { calls.push(['enable', id]); return job },
    async disable(id: number) { calls.push(['disable', id]); return { ...job, status: 'disabled' } },
    async resume(id: string) { calls.push(['resume', id]); return job },
    async get(id: string) { return id === job.jobId ? job : undefined },
    async list() { return [job] }
  } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const address = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${address.port}`
  try {
    const toggle = `${base}/api/admin/linkedin/accounts/103/comment-monitor`
    assert.equal((await fetch(`${base}/api/admin/linkedin/comment-monitors`)).status, 401)
    const provider = await login(base, 'Nariman', 'Nariman')
    assert.equal((await fetch(toggle, { method: 'PUT', headers: { Cookie: provider,
      'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).status, 403)
    const admin = await login(base, 'unicornveryevil@gmail.com', '101010')
    const headers = { Cookie: admin, 'Content-Type': 'application/json' }
    assert.equal((await fetch(`${base}/api/admin/linkedin/comment-monitors`, { headers })).status, 200)
    assert.equal((await fetch(`${base}/api/admin/linkedin/comment-monitors/comments-1`, {
      headers })).status, 200)
    assert.equal((await fetch(toggle, { method: 'PUT', headers,
      body: JSON.stringify({ enabled: true }) })).status, 202)
    assert.equal((await fetch(toggle, { method: 'PUT', headers,
      body: JSON.stringify({ enabled: false }) })).status, 200)
    assert.equal((await fetch(`${base}/api/admin/linkedin/comment-monitors/comments-1/resume`, {
      method: 'POST', headers })).status, 202)
    assert.deepEqual(calls, [['enable', 103], ['disable', 103], ['resume', 'comments-1']])
  } finally { await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => error ? reject(error) : resolve())) }
}

run().then(() => console.log('comment monitor route tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
