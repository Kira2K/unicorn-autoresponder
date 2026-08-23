const assert = require('node:assert/strict')
const { createLinkedInAuthLogger } = require('../auth-logger.ts') as {
  createLinkedInAuthLogger(options: any): import('../auth-logger.ts').AuthLogger
}

async function run(): Promise<void> {
  const lines: string[] = []
  const progress: string[] = []
  const logger = createLinkedInAuthLogger({
    runId: 'test-run',
    writeLine: (line: string) => lines.push(line),
    writeProgress: (line: string) => progress.push(line)
  })

  logger.event('proxy_summary', 'succeeded', {
    dolphinProfileId: 200,
    dolphinProtocol: 'socks5',
    unipileProtocol: 'https',
    authenticated: true,
    liAt: 'SECRET_LI_AT',
    userAgent: 'SECRET_USER_AGENT',
    proxyPassword: 'SECRET_PROXY_PASSWORD',
    proxyHost: 'SECRET_PROXY_HOST'
  } as any)

  await assert.rejects(
    logger.run('session_validated', {}, async () => {
      throw new Error('SECRET_ERROR_MESSAGE')
    })
  )

  const output = [...lines, ...progress].join('\n')
  for (const secret of [
    'SECRET_LI_AT', 'SECRET_USER_AGENT', 'SECRET_PROXY_PASSWORD',
    'SECRET_PROXY_HOST', 'SECRET_ERROR_MESSAGE'
  ]) assert.equal(output.includes(secret), false)

  const proxyRecord = JSON.parse(lines[0])
  assert.equal(proxyRecord.dolphinProtocol, 'socks5')
  assert.equal(proxyRecord.unipileProtocol, 'https')
  assert.equal(proxyRecord.authenticated, true)
  assert.equal(proxyRecord.proxyHost, undefined)

  const failed = lines.map(line => JSON.parse(line)).find(record => record.status === 'failed')
  assert.equal(failed.errorCode, 'linkedin_auth_internal_error')

  const resilient = createLinkedInAuthLogger({
    writeLine() { throw new Error('disk unavailable') },
    writeProgress() { throw new Error('stderr unavailable') }
  })
  assert.equal(await resilient.run('noco_checked', {}, async () => 42), 42)
}

module.exports = { run }
