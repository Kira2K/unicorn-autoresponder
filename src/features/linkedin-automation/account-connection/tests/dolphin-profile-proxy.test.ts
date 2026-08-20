const assert = require('node:assert/strict')
const {
  createAndAttachDolphinProxy,
  getDolphinProfileWithProxy
} = require('../../../../integrations/dolphin/profile-proxy.ts') as {
  createAndAttachDolphinProxy(id: number, proxy: any, request: any): Promise<void>
  getDolphinProfileWithProxy(id: number, dependencies: any): Promise<any>
}

async function run(): Promise<void> {
  const calls: any[] = []
  const profile = await getDolphinProfileWithProxy(7, {
    async getProfile() { return { id: 7, proxyId: 91, proxy: { id: 91, type: 'http' } } },
    async request(path: string, options: any) {
      calls.push({ path, options })
      return { data: [{ id: 91, type: 'http', host: 'proxy.test', port: 8080 }] }
    }
  })
  assert.equal(profile.proxy.host, 'proxy.test')
  assert.deepEqual(calls, [{ path: '/proxy', options: { query: { ids: '91' } } }])

  const embedded = { proxy: { id: 1, host: 'ready.test', port: 80 } }
  const same = await getDolphinProfileWithProxy(8, {
    async getProfile() { return embedded },
    async request() { throw new Error('must not fetch') }
  })
  assert.equal(same, embedded)

  const writes: any[] = []
  await createAndAttachDolphinProxy(8, {
    type: 'socks5', host: 'new.test', port: 1080, login: 'user', password: 'secret'
  }, async (path: string, options: any) => {
    writes.push({ path, options })
    return path === '/proxy' ? { data: { id: 77 } } : { data: { id: 8 } }
  })
  assert.deepEqual(writes[0], {
    path: '/proxy', options: { method: 'POST', body: {
      type: 'socks5', host: 'new.test', port: 1080,
      login: 'user', password: 'secret', name: 'LinkedIn auth | Dolphin 8'
    } }
  })
  assert.deepEqual(writes[1], {
    path: '/browser_profiles/8', options: { method: 'PATCH', body: { proxy: { id: 77 } } }
  })
}

module.exports = { run }
