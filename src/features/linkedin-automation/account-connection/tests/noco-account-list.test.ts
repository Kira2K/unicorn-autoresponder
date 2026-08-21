const assert = require('node:assert/strict')
const { listLinkedInAuthAccounts } = require('../noco-account-list.ts') as {
  listLinkedInAuthAccounts(input: any): any[]
}

async function run(): Promise<void> {
  const clients = [
    { Id: 1, client_name: 'Ready Client' },
    { Id: 2, client_name: 'Missing Profile' }
  ]
  const accounts = [
    {
      Id: 10, clients_id: 1, platforms_id: 16,
      linkedin_url: 'https://www.linkedin.com/in/ready/',
      unipile_account_id: 'acc_1', unipile_account_status: 'running',
      linkedin_auth_error_code: 'Proxy failed: SECRET token!',
      linkedin_last_verified_at: '2026-08-20T10:00:00.000Z'
    },
    {
      Id: 20, clients_id: 2, platforms_id: 16,
      linkedin_url: 'https://www.linkedin.com/in/missing/'
    },
    { Id: 30, clients_id: 1, platforms_id: 1 }
  ]
  const profiles = [
    { Id: 100, clients_id: 1, locale: 'En', dolphin_profile_id: 777 }
  ]
  const rows = listLinkedInAuthAccounts({ clients, accounts, profiles })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].clientName, 'Missing Profile')
  assert.equal(rows[0].readinessErrorCode, 'dolphin_en_profile_not_found')
  assert.equal(rows[1].dolphinProfileId, 777)
  assert.equal(rows[1].unipileAccountId, 'acc_1')
  assert.equal(rows[1].authErrorCode, 'linkedin_auth_internal_error')
  assert.equal(JSON.stringify(rows).includes('SECRET'), false)
}

module.exports = { run }
