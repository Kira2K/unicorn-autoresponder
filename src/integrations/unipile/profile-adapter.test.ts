const assert = require('node:assert/strict')
const { createUnipileProfileAdapter } = require('./profile-adapter.ts') as any

async function run() {
  const calls: string[] = []
  const options: any[] = []
  const adapter = createUnipileProfileAdapter({
    async request(method: string, path: string, _body?: unknown, requestOptions?: unknown) {
      calls.push(`${method} ${path}`)
      options.push(requestOptions)
      if (path.includes('/search/parameters')) return { data: [{ id: '1', name: 'QA' }] }
      return {}
    }
  })
  await adapter.getAccount('acc_1')
  await adapter.getOwnProfile('acc_1', ['linkedin_skills'])
  await adapter.getOwnProfile('acc_1', ['linkedin_experience'], { fresh: true })
  await adapter.updateOwnProfile('acc_1', { bio: 'Safe' })
  assert.deepEqual(await adapter.searchParameters('acc_1', 'JOB_TITLE', 'QA'), [{ id: '1', name: 'QA' }])
  assert.deepEqual(await adapter.searchParameters('acc_1', 'JOB_TITLE', ' qa '), [{ id: '1', name: 'QA' }])
  assert.equal(calls[0], 'GET /accounts/acc_1')
  assert.match(calls[1], /^GET \/acc_1\/users\/me\?variant=linkedin_classic/)
  assert.deepEqual(options[1], { noCache: false, fullRetryAfter: true })
  assert.deepEqual(options[2], { noCache: true, fullRetryAfter: true })
  assert.deepEqual(options[3], { fullRetryAfter: true })
  assert.equal(calls[3], 'PATCH /acc_1/users/me')
  assert.equal(calls.filter(call => call.includes('/search/parameters')).length, 1)
  assert.deepEqual(options[4], { fullRetryAfter: true })
  assert.equal(JSON.stringify(calls).includes('Safe'), false)

  let failedCalls = 0
  const retryable = createUnipileProfileAdapter({ async request() {
    failedCalls += 1
    if (failedCalls === 1) throw new Error('temporary')
    return { data: [{ id: '2', name: 'Acme' }] }
  } }, { scheduler: { run: (operation: () => Promise<unknown>) => operation() } })
  await assert.rejects(retryable.searchParameters('acc_1', 'COMPANY', 'Acme'))
  assert.deepEqual(await retryable.searchParameters('acc_1', 'COMPANY', 'Acme'),
    [{ id: '2', name: 'Acme' }])
  assert.equal(failedCalls, 2)
}

run().then(() => console.log('unipile profile adapter tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
