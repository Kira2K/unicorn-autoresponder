import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as appModule from './app.ts'
import { createMockConnectionInviterService } from './connection-inviter-mock.ts'
const { createWebConsoleApp } = appModule as unknown as { createWebConsoleApp(options: any): import('express').Express }
test('real console routes enforce admin, IDs and confirmation; GET does not mutate', async () => {
  const inviter = createMockConnectionInviterService()
  const operations = inviter.withdrawals!
  let starts = 0
  const original = operations.start
  operations.start = async (...args) => { starts++; return original(...args) }
  const app = createWebConsoleApp({ useMockData: true, connectionInviter: inviter })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  const url = `${base}/api/admin/linkedin/accounts/203/invitation-withdrawal`
  async function login(email: string, password: string) {
    const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    return { Cookie: String(response.headers.get('set-cookie')).split(';')[0], 'Content-Type': 'application/json' }
  }
  try {
    for (const path of [url, `${url}/preview`]) assert.equal((await fetch(path)).status, 401)
    assert.equal((await fetch(url, { method: 'POST' })).status, 401)
    assert.equal((await fetch(`${url}/recheck`, { method: 'POST' })).status, 401)
    const student = await login('Nariman', 'Nariman')
    assert.equal((await fetch(`${url}/preview`, { headers: student })).status, 403)
    assert.equal((await fetch(`${url}/recheck`, { method: 'POST', headers: student })).status, 403)
    const headers = await login('unicornveryevil@gmail.com', '101010')
    assert.equal(await (await fetch(url, { headers })).json(), null)
    const preview = await (await fetch(`${url}/preview`, { headers })).json()
    assert.equal(preview.items.length, 4); assert.equal(starts, 0)
    assert.equal((await fetch(`${url}/recheck`, { method: 'POST', headers, body: '{}' })).status, 400)
    assert.equal((await fetch(url.replace('/203/', '/-1/'), { headers })).status, 400)
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: preview.token }) })).status, 400)
    assert.equal(starts, 0)
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ token: preview.token, confirm: true }) })).status, 202)
    assert.equal((await fetch(`${url}/stop`, { method: 'POST', headers })).status, 200)
    for (let i = 0; i < 100 && operations.busy(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    const checked = await fetch(`${url}/recheck`, { method: 'POST', headers, body: JSON.stringify({ runId: preview.token }) })
    assert.equal(checked.status, 200); assert.equal((await checked.json()).status, 'stopped')
    assert.equal(starts, 1)
    assert.equal((await fetch(`${url}/recheck`, { method: 'POST', headers,
      body: JSON.stringify({ runId: '00000000-0000-0000-0000-000000000000' }) })).status, 409)
    await operations.close()
    assert.equal((await (await fetch(url, { headers })).json()).status, 'stopped')
  } finally { await operations.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
