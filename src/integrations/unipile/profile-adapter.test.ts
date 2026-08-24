const assert = require('node:assert/strict')
const { createUnipileProfileAdapter } = require('./profile-adapter.ts') as any

async function run() {
  const calls: string[] = []
  const adapter = createUnipileProfileAdapter({
    async request(method: string, path: string) {
      calls.push(`${method} ${path}`)
      if (path.includes('/search/parameters')) return { data: [{ id: '1', name: 'QA' }] }
      return {}
    }
  })
  await adapter.getAccount('acc_1')
  await adapter.getOwnProfile('acc_1', ['linkedin_skills'])
  await adapter.updateOwnProfile('acc_1', { bio: 'Safe' })
  assert.deepEqual(await adapter.searchParameters('acc_1', 'JOB_TITLE', 'QA'), [{ id: '1', name: 'QA' }])
  assert.equal(calls[0], 'GET /accounts/acc_1')
  assert.match(calls[1], /^GET \/acc_1\/users\/me\?variant=linkedin_classic/)
  assert.equal(calls[2], 'PATCH /acc_1/users/me')
  assert.equal(JSON.stringify(calls).includes('Safe'), false)
}

run().then(() => console.log('unipile profile adapter tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
