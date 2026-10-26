import assert from 'node:assert/strict'
import { after, test, type TestContext } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const previousToken = process.env.dolphin_api_token
process.env.dolphin_api_token = 'test-token'
after(() => {
  if (previousToken === undefined) delete process.env.dolphin_api_token
  else process.env.dolphin_api_token = previousToken
})

const diagnostics = require('../../features/diagnostics/dolphyn-connector.ts')
const inventory = require('./proxyProvider/checkRequiredProxy/dolphin-api.ts')
const { createDefaultDolphinProvisioningApi, createDolphinProfileProvisioner } = require('../../features/web-console/backend/dolphin-profile-provisioning.ts')
const cleanup = require('../noco/dolphin-tag-cleanup/index.ts')
const provisioning = createDefaultDolphinProvisioningApi()

const first = {
  id: 11, name: ' First ', tags: ['keep', 'Ready'], proxyId: 7, customField: 'preserved',
  proxy: { id: 7, name: ' Proxy ', type: 'socks5', browser_profiles_count: 1, lastCheck: { status: true }, password: 'private' }
}
const second = { id: 12, name: 'Second', tags: [] }
const detail = (profile: typeof first | typeof second) => ({ ...profile, tags: ['from-details'] })
const safeSnapshot = (profile: typeof first | typeof second) => ({
  id: String(profile.id), name: profile.name.trim(),
  proxyId: 'proxyId' in profile ? '7' : undefined,
  proxy: 'proxy' in profile
    ? { id: 7, name: 'Proxy', type: 'socks5', browserProfilesCount: 1, lastCheckStatus: true }
    : null
})

function mockCloud(t: TestContext, handler: (url: URL, method: string, body: unknown) => unknown) {
  const calls: Array<{ path: string; method: string; query: Record<string, string> }> = []
  t.mock.method(globalThis, 'fetch', async (input: string, options: RequestInit = {}) => {
    const url = new URL(input)
    assert.equal(url.origin, 'https://dolphin-anty-api.com')
    const method = options.method ?? 'GET'
    calls.push({ path: url.pathname, method, query: Object.fromEntries(url.searchParams) })
    const body = options.body ? JSON.parse(String(options.body)) : undefined
    return new Response(JSON.stringify(await handler(url, method, body)), { status: 200 })
  })
  return calls
}

const consumers: Array<[string, () => Promise<unknown[]>, unknown[]]> = [
  ['diagnostics export', () => diagnostics.getAllBrowserProfiles(), [first, second]],
  ['proxy inventory', () => inventory.getAllDolphinProfileSnapshots(), [first, second].map(safeSnapshot)],
  ['profile provisioning', () => provisioning.listProfiles(), [first, second]],
  ['tag cleanup', () => cleanup.fetchAllDolphinProfiles(), [first, second].map(profile => ({
    id: String(profile.id), name: profile.name.trim(), tags: detail(profile).tags
  }))]
]

for (const [name, read, expected] of consumers) {
  test(`${name} reads all cursor pages, deduplicates IDs and keeps its output contract`, async t => {
    const calls = mockCloud(t, (url, method) => {
      assert.equal(method, 'GET', 'Listing profiles must not write anything')
      if (url.pathname === '/browser_profiles/list-cursor') {
        assert.equal(url.searchParams.get('limit'), '100')
        assert.equal(url.searchParams.has('page'), false)
        return url.searchParams.get('cursor') === 'next+/='
          ? { data: [first, second], next_page_url: null }
          : { data: [first], next_page_url: '/browser_profiles/list-cursor?cursor=next%2B%2F%3D' }
      }
      if (name === 'tag cleanup') {
        const profile = [first, second].find(item => url.pathname === `/browser_profiles/${item.id}`)
        assert.ok(profile, `Unexpected detail request ${url.pathname}`)
        return { data: detail(profile) }
      }
      assert.fail(`Unexpected request ${url.pathname}`)
    })
    assert.deepEqual(await read(), expected)
    assert.equal(calls.filter(call => call.path === '/browser_profiles/list-cursor').length, 2)
    assert.equal(calls.length, name === 'tag cleanup' ? 4 : 2)
  })

  test(`${name} returns an empty list without detail requests`, async t => {
    const calls = mockCloud(t, (url, method) => {
      assert.equal(method, 'GET')
      assert.equal(url.pathname, '/browser_profiles/list-cursor')
      return { data: [], total: 0, next_page_url: null }
    })
    assert.deepEqual(await read(), [])
    assert.equal(calls.length, 1)
  })

  test(`${name} propagates a broken second page without writes or a partial result`, async t => {
    let count = 0
    const calls = mockCloud(t, (url, method) => {
      assert.equal(method, 'GET')
      assert.equal(url.pathname, '/browser_profiles/list-cursor')
      return ++count === 1 ? { data: [first], next_page_url: '?cursor=next' } : { data: null }
    })
    await assert.rejects(read(), /Dolphin.*data/)
    assert.equal(calls.length, 2)
  })

  test(`${name} rejects premature cursor completion instead of accepting a partial inventory`, async t => {
    const calls = mockCloud(t, (url, method) => {
      assert.equal(method, 'GET')
      assert.equal(url.pathname, '/browser_profiles/list-cursor')
      return url.searchParams.has('cursor')
        ? { data: [], total: 2, next_page_url: null }
        : { data: [first], total: 2, next_page_url: '?cursor=next' }
    })
    await assert.rejects(read(), /неполный.*1.*2/)
    assert.equal(calls.length, 2)
  })
}

test('diagnostics still request only one cursor page with the supplied limit and preserve total', async t => {
  const page = { data: [first], total: 42, per_page: 1, next_page_url: '?cursor=next' }
  const calls = mockCloud(t, () => page)
  assert.deepEqual(await diagnostics.getBrowserProfiles(1), page)
  assert.deepEqual(calls, [{ path: '/browser_profiles/list-cursor', method: 'GET', query: { limit: '1' } }])
})

test('provisioning never creates or binds a profile after an incomplete inventory', async t => {
  const calls = mockCloud(t, (url, method) => {
    assert.equal(method, 'GET')
    assert.equal(url.pathname, '/browser_profiles/list-cursor')
    return url.searchParams.has('cursor')
      ? { data: [], total: 2, next_page_url: null }
      : { data: [first], total: 2, next_page_url: '?cursor=next' }
  })
  const forbiddenWrite = async () => assert.fail('Incomplete inventory must not create, update or bind profiles')
  const service = createDolphinProfileProvisioner({
    repository: { createDolphinProfileBinding: forbiddenWrite }, templateProfileId: 99,
    api: { getProfile: async () => ({ platform: 'windows', browserType: 'anty' }),
      listProfiles: () => provisioning.listProfiles(), listProxies: async () => [],
      createProfile: forbiddenWrite, updateProxy: forbiddenWrite, updateProfileTags: forbiddenWrite }
  })
  await assert.rejects(service.ensureClientProfiles({
    client: { id: 7, clientName: 'Test User', firstName: 'Test', lastName: 'User',
      primaryStack: 'Go', commonChatId: 'test-chat', market: 'Ru' },
    existingProfiles: [], actorRole: 'admin'
  }), /неполный.*1.*2/)
  assert.equal(calls.length, 2)
})

test('proxy pagination, individual profile reads and POST creation keep their endpoints and payloads', async t => {
  const payload = { name: 'new profile', tags: ['Ready'] }
  const calls = mockCloud(t, (url, method, body) => {
    if (url.pathname === '/proxy') {
      assert.equal(method, 'GET')
      return { data: [{ id: Number(url.searchParams.get('page')) }], total: 2, last_page: 2 }
    }
    if (url.pathname === '/browser_profiles/11') {
      assert.equal(method, 'GET')
      return { data: first }
    }
    assert.equal(url.pathname, '/browser_profiles')
    assert.equal(method, 'POST')
    assert.deepEqual(body, payload)
    return { data: { id: 13 } }
  })
  assert.deepEqual(await provisioning.listProxies(), [{ id: 1 }, { id: 2 }])
  assert.equal((await inventory.getAllDolphinProxySnapshots()).length, 2)
  assert.deepEqual(await provisioning.getProfile(11), first)
  assert.deepEqual(await inventory.getDolphinProfileSnapshot('11'), { ...safeSnapshot(first), name: first.name })
  assert.deepEqual(await provisioning.createProfile(payload), { data: { id: 13 } })
  assert.deepEqual(calls, [
    ...[1, 2, 1, 2].map(page => ({ path: '/proxy', method: 'GET', query: { limit: '100', page: String(page) } })),
    { path: '/browser_profiles/11', method: 'GET', query: {} },
    { path: '/browser_profiles/11', method: 'GET', query: {} },
    { path: '/browser_profiles', method: 'POST', query: {} }
  ])
})
