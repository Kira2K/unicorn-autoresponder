import assert from 'node:assert/strict'
import { test } from 'node:test'
import { octoApi, octoGrantForDisplay } from './octo-api.js'

test('Octo credentials are kept only during a valid granted window, preserving leading zeros', () => {
  const grant = { id: 'g1', profileId: 1, phase: 'granted', expiresAt: 2000, password: '00123', guest: { email: 'guest@example.test', password: 'guest-secret' } }
  assert.equal(octoGrantForDisplay(grant, 1000).password, '00123')
  assert.deepEqual(octoGrantForDisplay(grant, 1000).guest, grant.guest)
  for (const candidate of [
    { ...grant, expiresAt: 1000 }, { ...grant, expiresAt: undefined },
    { ...grant, expiresAt: '2000' }, { ...grant, password: 12345 },
    { ...grant, password: '1234' }, { ...grant, password: '123456' },
    ...['preparing', 'awaiting_close', 'complete', 'blocked'].map(phase => ({ ...grant, phase }))
  ]) {
    const result = octoGrantForDisplay(candidate, 1000)
    assert.equal('password' in result, false)
    assert.equal('guest' in result, false)
    assert.equal(result.id, 'g1')
  }
  assert.equal(grant.password, '00123', 'sanitizing does not mutate transport data')
})

test('Octo requests use existing cookies and expected payloads; a forbidden response remains recognizable', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => ({ id: 'g1', phase: 'preparing' }) }
  }
  try {
    const signal = new AbortController().signal
    await octoApi.profileStatus({ signal })
    await octoApi.ensureProfiles(true, { signal })
    await octoApi.requestGrant(7, { signal })
    await octoApi.grant('grant/1', { signal })
    assert.deepEqual(calls.map(call => call.path), [
      '/api/octo/profiles/status', '/api/octo/profiles/ensure', '/api/octo/grants', '/api/octo/grants/grant%2F1'
    ])
    assert.deepEqual(JSON.parse(calls[1].options.body), { ownProxy: true })
    assert.deepEqual(JSON.parse(calls[2].options.body), { profileId: 7 })
    for (const { options } of calls) {
      assert.equal(options.credentials, 'include')
      assert.equal(options.signal, signal)
      assert.equal(options.headers.Authorization, undefined)
    }
    globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
    await assert.rejects(octoApi.profileStatus(), error => error.status === 403)
  } finally {
    globalThis.fetch = originalFetch
  }
})
