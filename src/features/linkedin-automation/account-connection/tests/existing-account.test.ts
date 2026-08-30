const assert = require('node:assert/strict')
const { findExistingLinkedInAccount, likelyAccount } = require('../existing-account.ts') as any

const target = {
  platformAccountId: 628,
  expectedLinkedInUrl: 'linkedin.com/in/bulat-sharipov'
}
const accounts = [
  { id: 'acc_diana', provider: 'linkedin', name: 'Diana Kuanyshkyzy' },
  { id: 'acc_bulat', provider: 'linkedin', name: 'Bulat Sharipov', status: 'running' }
]
const logger = {
  event() {},
  async run(_stage: string, _details: any, action: () => Promise<any>) { return await action() }
}

async function run(): Promise<void> {
  assert.equal(likelyAccount(accounts[1], target), true)
  const reads: string[] = []
  const found = await findExistingLinkedInAccount(target, {
    async listAccounts() { return accounts },
    async getOwnProfile(id: string) {
      reads.push(id)
      return { public_identifier: id === 'acc_bulat' ? 'bulat-sharipov' : 'diana' }
    }
  }, logger)
  assert.equal(found.id, 'acc_bulat')
  assert.deepEqual(reads, ['acc_bulat'])
}

module.exports = { run }
