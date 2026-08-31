const assert = require('node:assert/strict')
const { authIntentPayload, createUnipileAccountAdapter } = require('../../../../integrations/unipile/account-adapter.ts') as {
  authIntentPayload(input: any): any
  createUnipileAccountAdapter(http: any): any
}

async function run(): Promise<void> {
  const proxy = {
    host: 'proxy.test', port: 1080, protocol: 'socks5',
    username: 'student', password: 'proxy-secret'
  }
  const payload = authIntentPayload({
    liAt: 'li-at-secret', userAgent: 'Dolphin Agent', proxy,
    accountId: 'acc_existing', state: 'platform_account:20'
  })
  assert.deepEqual(payload, {
    provider: 'linkedin',
    account_id: 'acc_existing',
    state: 'platform_account:20',
    credentials: { access_token: 'li-at-secret', user_agent: 'Dolphin Agent' },
    config: { products: ['classic'], custom_proxy: {
      host: 'proxy.test', port: 1080, protocol: 'socks5',
      username: 'student', password: 'proxy-secret'
    } }
  })
  assert.equal('premium_access_token' in payload.credentials, false)
  const dataImpulsePayload = authIntentPayload({
    liAt: 'x', userAgent: 'ua', proxy: { ...proxy, host: 'gw.dataimpulse.com' }
  })
  assert.equal(dataImpulsePayload.config.custom_proxy.protocol, 'https')

  const calls: any[] = []
  const adapter = createUnipileAccountAdapter({
    async request(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body })
      if (path === '/accounts?limit=100') return { data: [{ id: 'acc_1' }] }
      if (path === '/auth/intent') return { object: 'Account', id: 'acc_1' }
      if (path === '/accounts/acc_1') return { id: 'acc_1', provider: 'linkedin' }
      return { public_identifier: 'kira-test' }
    }
  })
  assert.deepEqual(await adapter.listAccounts(), [{ id: 'acc_1' }])
  await adapter.authenticateLinkedIn({ liAt: 'x', userAgent: 'ua', proxy })
  await adapter.getAccount('acc_1')
  await adapter.getOwnProfile('acc_1')
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), [
    'GET /accounts?limit=100',
    'POST /auth/intent', 'GET /accounts/acc_1', 'GET /acc_1/users/me'
  ])
}

module.exports = { run }
