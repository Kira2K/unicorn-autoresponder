const assert = require('node:assert/strict')
const { verifiedIdentity } = require('../account-validation.ts') as {
  verifiedIdentity(account: any, profile: any, target: any): any
}

async function run(): Promise<void> {
  const account = { provider: 'linkedin', status: 'running', user_id: 'provider-1' }
  const target = {
    expectedLinkedInUrl: 'https://www.linkedin.com/in/kira-test/',
    verifiedProviderId: 'provider-1'
  }

  assert.equal(
    verifiedIdentity(account, {
      public_identifier: 'kira-test', provider_id: 'provider-1', name: 'Kira'
    }, target).profileUrl,
    'https://www.linkedin.com/in/kira-test/'
  )
  assert.throws(
    () => verifiedIdentity(account, {
      public_identifier: 'another-owner', provider_id: 'provider-1'
    }, target),
    (error: any) => error.code === 'linkedin_profile_mismatch'
  )
  assert.throws(
    () => verifiedIdentity(account, {
      public_identifier: 'kira-test', provider_id: 'provider-2'
    }, target),
    (error: any) => error.code === 'linkedin_provider_id_mismatch'
  )
}

module.exports = { run }
