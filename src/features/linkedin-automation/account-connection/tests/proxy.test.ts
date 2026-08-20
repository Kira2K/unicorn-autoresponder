const assert = require('node:assert/strict')
const { resolveLinkedInProxy, safeProxySummary } = require('../proxy.ts') as Record<string, (...args: any[]) => any>

async function run(): Promise<void> {
  const proxy = resolveLinkedInProxy({
    proxy: {
      type: 'socks5', host: 'proxy.example.com', port: 1080,
      login: 'student', password: 'proxy-secret', lastCheck: { status: true }
    }
  })
  assert.deepEqual(proxy, {
    protocol: 'socks5', host: 'proxy.example.com', port: 1080,
    username: 'student', password: 'proxy-secret'
  })
  const summary = safeProxySummary(proxy)
  assert.deepEqual(summary, { configured: true, protocol: 'socks5', authenticated: true })
  assert.equal(JSON.stringify(summary).includes('proxy-secret'), false)
  assert.throws(() => resolveLinkedInProxy({}), (error: any) => error.code === 'dolphin_proxy_missing')
  assert.throws(
    () => resolveLinkedInProxy({ proxy: { type: 'ssh', host: 'x', port: 22 } }),
    (error: any) => error.code === 'dolphin_proxy_protocol_unsupported'
  )
}

module.exports = { run }
