const assert = require('node:assert/strict')
const { resolveLinkedInAuthTarget } = require('../noco-target.ts') as {
  resolveLinkedInAuthTarget(input: any): any
}

function fixture() {
  return {
    clientName: 'Kira Test',
    clients: [{ Id: 1, client_name: 'Kira Test' }],
    accounts: [{
      Id: 20,
      clients_id: 1,
      platforms_id: 16,
      linkedin_url: 'https://linkedin.com/in/kira-test',
      unipile_account_id: 'acc_existing',
      linkedin_verified_provider_id: 'provider-1'
    }],
    profiles: [
      { Id: 30, clients_id: 1, locale: 'Ru', dolphin_profile_id: '100' },
      { Id: 31, clients_id: 1, locale: 'En', dolphin_profile_id: '200' }
    ]
  }
}

async function run(): Promise<void> {
  const target = resolveLinkedInAuthTarget(fixture())
  assert.deepEqual(target, {
    clientId: 1,
    clientName: 'Kira Test',
    dolphinProfileId: 200,
    platformAccountId: 20,
    expectedLinkedInUrl: 'https://linkedin.com/in/kira-test',
    unipileAccountId: 'acc_existing',
    unipileAccountStatus: undefined,
    verifiedProviderId: 'provider-1'
  })

  const missing = fixture()
  missing.profiles = missing.profiles.filter(row => row.locale !== 'En')
  assert.throws(
    () => resolveLinkedInAuthTarget(missing),
    (error: any) => error.code === 'dolphin_en_profile_not_found'
  )

  const ambiguous = fixture()
  ambiguous.accounts.push({ ...ambiguous.accounts[0], Id: 21 })
  assert.throws(
    () => resolveLinkedInAuthTarget(ambiguous),
    (error: any) => error.code === 'linkedin_account_ambiguous'
  )
  assert.equal(resolveLinkedInAuthTarget({ ...ambiguous, platformAccountId: 21 }).platformAccountId, 21)

  const realSchema = fixture()
  const realAccount: any = realSchema.accounts[0]
  realAccount.url = realAccount.linkedin_url
  delete realAccount.linkedin_url
  assert.equal(
    resolveLinkedInAuthTarget(realSchema).expectedLinkedInUrl,
    'https://linkedin.com/in/kira-test'
  )
}

module.exports = { run }
