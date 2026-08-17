const assert = require('node:assert/strict')
const test = require('node:test')
const { createMemoryLogger } = require('../../core/reporting/logger.ts') as typeof import('../../core/reporting/logger.ts')

test('structured logger redacts secrets in fields, nested proxy and text', () => {
  const { logger, entries } = createMemoryLogger({ minimumLevel: 'debug' })
  logger.child({ accountId: 'account-1', jobId: 'job-1' }).error(
    'test.secret',
    'Request failed: Bearer very-secret-token password=hunter2',
    {
      apiKey: 'unipile-secret',
      access_token: 'li-at-secret',
      proxy: { username: 'proxy-user', password: 'proxy-pass', host: 'proxy.example' },
      safe: 'visible',
    },
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0].accountId, 'account-1')
  assert.equal(entries[0].event, 'test.secret')
  const serialized = JSON.stringify(entries[0])
  for (const secret of ['very-secret-token', 'hunter2', 'unipile-secret', 'li-at-secret', 'proxy-user', 'proxy-pass']) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.equal(serialized.includes('[REDACTED]'), true)
  assert.equal(serialized.includes('proxy.example'), true)
  assert.equal(serialized.includes('visible'), true)
})
