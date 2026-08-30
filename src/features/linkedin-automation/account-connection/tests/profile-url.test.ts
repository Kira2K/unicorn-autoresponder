const assert = require('node:assert/strict')
const {
  assertLinkedInIdentity,
  canonicalLinkedInProfileUrl,
  linkedInPublicIdentifier
} = require('../profile-url.ts') as Record<string, (...args: any[]) => any>

async function run(): Promise<void> {
  assert.equal(linkedInPublicIdentifier('https://www.linkedin.com/in/Kira-Test/'), 'kira-test')
  assert.equal(linkedInPublicIdentifier('linkedin.com/in/Kira-Test/'), 'kira-test')
  assert.equal(linkedInPublicIdentifier('www.linkedin.com/in/Kira-Test/'), 'kira-test')
  assert.equal(assertLinkedInIdentity(
    'https://linkedin.com/in/kira-test',
    'https://www.linkedin.com/in/KIRA-TEST/'
  ), 'kira-test')
  assert.equal(canonicalLinkedInProfileUrl('kira-test'), 'https://www.linkedin.com/in/kira-test/')
  assert.throws(() => linkedInPublicIdentifier('https://example.com/in/kira'), /linkedin.com/)
  assert.throws(
    () => assertLinkedInIdentity('https://linkedin.com/in/kira', 'other'),
    (error: any) => error.code === 'linkedin_profile_mismatch'
  )
}

module.exports = { run }
