const assert = require('node:assert/strict')
const { runLinkedInAuth } = require('../auth-service.ts') as {
  runLinkedInAuth(input: any, dependencies: any): Promise<any>
}

const target = {
  clientId: 1, clientName: 'Kira', dolphinProfileId: 200, platformAccountId: 20,
  expectedLinkedInUrl: 'https://linkedin.com/in/kira-test'
}
const account = {
  object: 'Account', id: 'acc_1', user_id: 'provider-1', provider: 'linkedin',
  status: 'running', is_locked: false
}
const profile = {
  provider_id: 'provider-1', public_identifier: 'kira-test', name: 'Kira Test'
}

function dependencies(existing = false) {
  const successes: any[] = []
  let collected = 0
  const deps = {
    repository: {
      async assertSchema() {},
      async resolveTarget() {
        return existing ? { ...target, unipileAccountId: 'acc_1' } : target
      },
      async recordSuccess(_id: number, patch: any) { successes.push(patch) },
      async recordFailure() { throw new Error('unexpected failure patch') }
    },
    adapter: {
      async getAccount() { return account },
      async authenticateLinkedIn(input: any) {
        assert.equal(input.liAt, 'li-at-secret')
        return account
      },
      async getOwnProfile() { return profile }
    },
    async collectSession() {
      collected += 1
      return {
        session: { liAt: 'li-at-secret', userAgent: 'Dolphin Agent' },
        proxy: { host: 'proxy.test', port: 1080, protocol: 'socks5', password: 'proxy-secret' }
      }
    },
    async inspectProfile() { return { summary: { configured: true, protocol: 'socks5' } } }
  }
  return { deps, successes, collected: () => collected }
}

async function run(): Promise<void> {
  const initial = dependencies(false)
  const connected = await runLinkedInAuth({ clientName: 'Kira', apply: true }, initial.deps)
  assert.equal(connected.mode, 'connected')
  assert.equal(initial.collected(), 1)
  assert.equal(initial.successes[0].providerId, 'provider-1')
  assert.equal(JSON.stringify(initial.successes).includes('li-at-secret'), false)

  const current = dependencies(true)
  const verified = await runLinkedInAuth({ clientName: 'Kira', apply: true }, current.deps)
  assert.equal(verified.mode, 'verified')
  assert.equal(current.collected(), 0)

  const forced = dependencies(true)
  const refreshed = await runLinkedInAuth(
    { clientName: 'Kira', apply: true, forceReauth: true }, forced.deps
  )
  assert.equal(refreshed.mode, 'reconnected')
  assert.equal(forced.collected(), 1)
}

module.exports = { run }
