import assert from 'node:assert/strict'
import { test } from 'node:test'
import { octoApi, octoGrantForDisplay, octoProxyDraft, octoProxyPayload } from './octo-api.js'

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

test('Proxy drafts hydrate returned credentials; submission validates fields and preserves entered credentials', () => {
  const proxy = { type: 'socks5', host: 'proxy.example.test', port: 1080, login: 'saved-login', password: 'saved-password', changeIpUrl: 'https://private.example.test/secret' }
  const draft = octoProxyDraft(proxy)
  assert.deepEqual(draft, proxy)
  assert.deepEqual(octoProxyDraft(), { type: 'http', host: '', port: '', login: '', password: '', changeIpUrl: '' })
  const entered = { ...draft, host: ' proxy.example.test ', port: '1080', login: ' entered login ', password: ' entered password ', changeIpUrl: ' https://proxy.example.test/change ' }
  const payload = octoProxyPayload(entered)
  assert.deepEqual(payload, { type: 'socks5', host: 'proxy.example.test', port: 1080, login: ' entered login ', password: ' entered password ', changeIpUrl: 'https://proxy.example.test/change' })
  assert.equal(entered.port, '1080', 'payload preparation does not mutate user input')
  assert.equal(octoProxyPayload(draft).changeIpUrl, proxy.changeIpUrl)
  assert.deepEqual(octoProxyPayload({ ...draft, type: 'https', port: '443' }), {
    type: 'https', host: 'proxy.example.test', port: 443, login: 'saved-login', password: 'saved-password', changeIpUrl: proxy.changeIpUrl
  })
  for (const fields of [{ type: 'ftp' }, { host: '' }, { host: 'bad host' }, { port: '' }, { port: 0 }, { port: 65536 }, { port: 1.5 }, { changeIpUrl: 'bad-url' }, { changeIpUrl: 'file:///secret' }]) {
    assert.throws(() => octoProxyPayload({ ...draft, ...fields }), /^Error: invalid_proxy_fields$/)
  }
})

test('proxy credentials use the same status request only when explicitly requested', async () => {
  const originalFetch = globalThis.fetch, paths = []
  globalThis.fetch = async path => { paths.push(path); return { ok: true, json: async () => ({ profiles: [] }) } }
  try {
    await octoApi.profileStatus({ proxyCredentials: true })
    await octoApi.profileStatus()
    assert.deepEqual(paths, ['/api/octo/profiles/status?proxyCredentials=1', '/api/octo/profiles/status'])
  } finally { globalThis.fetch = originalFetch }
})

test('Proxy save uses authenticated profile-scoped POST and rejects invalid input before fetch', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => ({ proxy: { configured: false, phase: 'queued' } }) }
  }
  try {
    const signal = new AbortController().signal
    const draft = { type: 'http', host: 'proxy.example.test', port: '8080', login: 'login', password: 'password', changeIpUrl: '' }
    await octoApi.saveProxy(19, draft, { signal })
    assert.equal(calls[0].path, '/api/octo/profiles/19/proxy')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(calls[0].options.signal, signal)
    assert.deepEqual(JSON.parse(calls[0].options.body), { type: 'http', host: 'proxy.example.test', port: 8080, login: 'login', password: 'password' })
    assert.throws(() => octoApi.saveProxy(19, { ...draft, port: 0 }), /^Error: invalid_proxy_fields$/)
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
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

test('Onboarding requests send only selected source data, server key storage and location query; continue is explicit', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => ({ saved: true }) }
  }
  try {
    const signal = new AbortController().signal
    await octoApi.startOnboarding({ source: 'none', confirmDolphin: false }, { signal })
    await octoApi.startOnboarding({ source: 'own', confirmDolphin: true, proxy: 'socks5://user:pass@host:1080' }, { signal })
    await octoApi.saveNodeMavenKey(' secret-key ', { signal })
    await octoApi.locations('cities', { country: 'US', region: 'New York' }, { signal })
    await octoApi.continueOnboarding('setup/1', { signal })
    assert.deepEqual(calls.map(call => call.path), ['/api/octo/onboarding', '/api/octo/onboarding', '/api/octo/nodemaven-key', '/api/octo/locations?level=cities&country=US&region=New+York', '/api/octo/onboarding/setup%2F1/continue'])
    assert.deepEqual(JSON.parse(calls[0].options.body), { source: 'none', confirmDolphin: false })
    assert.deepEqual(JSON.parse(calls[1].options.body), { source: 'own', confirmDolphin: true, proxy: 'socks5://user:pass@host:1080' })
    assert.equal(calls[2].options.method, 'PUT')
    assert.deepEqual(JSON.parse(calls[2].options.body), { key: 'secret-key' })
    assert.deepEqual(JSON.parse(calls[4].options.body), { acceptLowScore: true })
    for (const { options } of calls) { assert.equal(options.credentials, 'include'); assert.equal(options.signal, signal); assert.equal(options.headers.Authorization, undefined) }
  } finally { globalThis.fetch = originalFetch }
})
