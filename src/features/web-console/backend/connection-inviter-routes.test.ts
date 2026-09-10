const assert = require('node:assert/strict')
const { createWebConsoleApp } = require('./app.ts') as any

async function login(base: string, email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return String(response.headers.get('set-cookie')).split(';')[0]
}

async function run() {
  const calls: any[] = []
  let readinessCalls = 0
  let raceReads = 0
  const job = { runId: 'connections-1', platformAccountId: 103, status: 'succeeded' }
  const raceJob = { runId: 'race-run', platformAccountId: 103, status: 'running', stage: 'searching' }
  const service = {
    settings() { return { writerEnabled: false } },
    async list() { return [job] },
    async get(id: string) {
      if (id === raceJob.runId) {
        raceReads += 1
        return raceReads === 1 ? raceJob : { ...raceJob, status: 'partial', stage: 'search_exhausted' }
      }
      return id === job.runId ? job : undefined
    },
    async history(id: number) { return [{ platformAccountId: id, personId: 'person' }] },
    async readiness(id: number) { readinessCalls += 1; return { platformAccountId: id, ready: true } },
    async stacks() { return [{ id: 7, name: 'PYTHON' }] },
    async saveStack(id: number, stackId: number) {
      calls.push(['stack', id, stackId]); return { platformAccountId: id, stackId }
    },
    async start(id: number, input: any) {
      if (id === 104) throw Object.assign(new Error('Read-back required.'),
        { code: 'connection_invitation_result_pending' })
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
    const settings = `${base}/api/admin/linkedin/connection-settings`
    assert.equal((await fetch(settings)).status, 401)
    assert.equal((await fetch(settings, { headers: { Cookie: provider } })).status, 403)
    const settingsResponse = await fetch(settings, { headers })
    assert.equal(settingsResponse.status, 200)
    assert.deepEqual(await settingsResponse.json(), { writerEnabled: false })
    assert.equal(readinessCalls, 0)
    assert.equal((await fetch(runs, { headers })).status, 200)
    assert.equal((await fetch(`${runs}/connections-1`, { headers })).status, 200)
    assert.equal((await fetch(`${runs}/connections-1/events`)).status, 401)
    const eventsAbort = new AbortController()
    const events = await fetch(`${runs}/connections-1/events`, { headers, signal: eventsAbort.signal })
    assert.equal(events.status, 200)
    assert.match(events.headers.get('content-type') || '', /text\/event-stream/)
    const firstEvent = await events.body!.getReader().read()
    assert.match(new TextDecoder().decode(firstEvent.value), /event: snapshot/)
    eventsAbort.abort()
    const raceAbort = new AbortController()
    const raceEvents = await fetch(`${runs}/race-run/events`, { headers, signal: raceAbort.signal })
    const raceEvent = await raceEvents.body!.getReader().read()
    const raceSnapshot = new TextDecoder().decode(raceEvent.value)
    assert.match(raceSnapshot, /event: snapshot/)
    assert.match(raceSnapshot, /"status":"partial"/)
    raceAbort.abort()
    assert.equal((await fetch(`${runs}/connections-1/stop`, { method: 'POST', headers })).status, 202)
    assert.equal((await fetch(`${base}/api/admin/linkedin/connection-stacks`, { headers })).status, 200)
    const account = `${base}/api/admin/linkedin/accounts/103`
    assert.equal((await fetch(`${account}/connection-readiness`, { headers })).status, 200)
    assert.equal(readinessCalls, 1)
    assert.equal((await fetch(`${account}/connection-history`, { headers })).status, 200)
    assert.equal((await fetch(`${account}/connection-stack`, { method: 'PUT', headers,
      body: JSON.stringify({ stackId: 7 }) })).status, 200)
    assert.equal((await fetch(`${account}/connection-runs`, { method: 'POST', headers,
      body: JSON.stringify({ safeRecruiterOnly: true }) })).status, 202)
    const blocked = await fetch(`${base}/api/admin/linkedin/accounts/104/connection-runs`, {
      method: 'POST', headers, body: JSON.stringify({ safeRecruiterOnly: false }) })
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json()).error, 'connection_invitation_result_pending')
    assert.deepEqual(calls, [['stop', 'connections-1'], ['stack', 103, 7], ['start', 103, true]])
  } finally { await new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => error ? reject(error) : resolve())) }
}

run().then(() => console.log('connection inviter route tests passed'))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1 })
