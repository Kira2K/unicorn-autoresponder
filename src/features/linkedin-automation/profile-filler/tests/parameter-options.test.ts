const assert = require('node:assert/strict')
const { findParameterOptions } = require('../parameter-options.ts') as any

async function run() {
  const events: any[] = []
  const result = await findParameterOptions({
    platformAccountId: 7, type: 'job_title', keywords: 'Backend Engineer',
    repository: { async listAccounts() { return [{
      platformAccountId: 7, unipileAccountId: 'acc-1',
      unipileAccountStatus: 'running', lastVerifiedAt: '2026-08-23T00:00:00Z'
    }] } },
    client: { async searchParameters(accountId: string, type: string, keywords: string) {
      assert.deepEqual([accountId, type, keywords], ['acc-1', 'JOB_TITLE', 'Backend Engineer'])
      return Array.from({ length: 10 }, (_, index) => ({ id: String(index), name: `Option ${index}` }))
    } },
    logger: { event: (...args: any[]) => events.push(args) }
  })
  assert.equal(result.items.length, 8)
  assert.deepEqual(result.items[0], { name: 'Option 0' })
  assert.equal(JSON.stringify(result).includes('acc-1'), false)
  assert.equal(JSON.stringify(result).includes('"id"'), false)
  assert.equal(JSON.stringify(events).includes('Backend Engineer'), false)
  const queries: string[] = []
  const fallback = await findParameterOptions({
    platformAccountId: 7, type: 'JOB_TITLE', keywords: 'Senior Go Backend Developer',
    repository: { async listAccounts() { return [{ platformAccountId: 7,
      unipileAccountId: 'acc-1', unipileAccountStatus: 'running',
      lastVerifiedAt: '2026-08-23T00:00:00Z' }] } },
    client: { async searchParameters(_account: string, _type: string, keywords: string) {
      queries.push(keywords)
      return keywords === 'Backend Developer' ? [{ id: '1', name: 'Backend Developer' }] : []
    } }, logger: { event: (...args: any[]) => events.push(args) }
  })
  assert.deepEqual(fallback.items, [{ name: 'Backend Developer' }])
  assert.deepEqual(queries, ['Senior Go Backend Developer', 'Go Backend Developer',
    'Backend Developer', 'Software Engineer'])
  await assert.rejects(() => findParameterOptions({ platformAccountId: 7, type: 'BAD',
    keywords: 'test', repository: {}, client: {}, logger: { event() {} } }),
  { code: 'profile_parameter_search_invalid' })
}

run().then(() => console.log('profile parameter options tests passed')).catch((error: unknown) => {
  console.error(error); process.exitCode = 1
})
