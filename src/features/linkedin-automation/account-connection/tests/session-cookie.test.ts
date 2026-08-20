const assert = require('node:assert/strict')
const { extractLinkedInSession } = require('../session-cookie.ts') as {
  extractLinkedInSession(input: any): any
}

const base = {
  cookies: [
    { name: 'li_at', value: 'secret-li-at', domain: '.linkedin.com', expires: 2_000 },
    { name: 'li_a', value: 'must-not-be-read', domain: '.linkedin.com', expires: 2_000 }
  ],
  userAgent: 'Dolphin Agent',
  profileUrl: 'https://www.linkedin.com/in/kira-test/',
  expectedLinkedInUrl: 'https://linkedin.com/in/kira-test',
  nowSeconds: 1_000
}

async function run(): Promise<void> {
  const session = extractLinkedInSession(base)
  assert.deepEqual(session, {
    liAt: 'secret-li-at',
    userAgent: 'Dolphin Agent',
    profileUrl: base.profileUrl,
    publicIdentifier: 'kira-test'
  })
  assert.equal(JSON.stringify(session).includes('must-not-be-read'), false)
  assert.throws(
    () => extractLinkedInSession({ ...base, cookies: [] }),
    (error: any) => error.code === 'linkedin_li_at_missing'
  )
  assert.throws(
    () => extractLinkedInSession({ ...base, nowSeconds: 3_000 }),
    (error: any) => error.code === 'linkedin_li_at_missing'
  )
}

module.exports = { run }
