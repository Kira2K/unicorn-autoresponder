const assert = require('node:assert/strict')
const { runLinkedInAuth } = require('../auth-service.ts') as {
  runLinkedInAuth(input: any, dependencies: any): Promise<any>
}

const target = {
  clientId: 1, clientName: 'Kira', dolphinProfileId: 200, platformAccountId: 20,
  expectedLinkedInUrl: 'https://linkedin.com/in/kira-test'
}

function baseDependencies() {
  const failures: any[] = []
  return {
    failures,
    dependencies: {
      repository: {
        async assertSchema() {}, async resolveTarget() { return target },
        async recordSuccess() { throw new Error('unexpected success') },
        async recordFailure(_id: number, patch: any) { failures.push(patch) }
      },
      adapter: {
        async authenticateLinkedIn() {
          return { object: 'AuthenticationCheckpoint', checkpoint: { type: '2FA' } }
        }
      },
      async collectSession() {
        return {
          session: { liAt: 'li-at-secret', userAgent: 'Dolphin Agent' },
          proxy: { host: 'proxy.test', port: 1080, protocol: 'socks5', password: 'proxy-secret' }
        }
      },
      async inspectProfile() { return { summary: { configured: true, protocol: 'socks5' } } }
    }
  }
}

async function run(): Promise<void> {
  const checkpoint = baseDependencies()
  await assert.rejects(
    () => runLinkedInAuth({ clientName: 'Kira', apply: true }, checkpoint.dependencies),
    (error: any) => error.code === 'unipile_checkpoint_2fa'
  )
  assert.equal(checkpoint.failures[0].errorCode, 'unipile_checkpoint_2fa')
  assert.equal(JSON.stringify(checkpoint.failures).includes('li-at-secret'), false)
  assert.equal(JSON.stringify(checkpoint.failures).includes('proxy-secret'), false)

  const dry = baseDependencies()
  const result = await runLinkedInAuth({ clientName: 'Kira', apply: false }, dry.dependencies)
  assert.equal(result.mode, 'dry-run')
  assert.deepEqual(result.proxy, { configured: true, protocol: 'socks5' })
  assert.equal(JSON.stringify(result).includes('proxy.test'), false)
}

module.exports = { run }
