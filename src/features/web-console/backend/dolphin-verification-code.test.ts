const assert = require('node:assert/strict')
const {
  DOLPHIN_VERIFICATION_SUBJECT,
  GMAIL_READONLY_SCOPE,
  createGmailClient,
  createGmailOAuthUrl,
  extractVerificationCode,
  isDolphinVerificationEmail,
  latestVerificationCode,
  toVerificationEmail
} = require('./dolphin-verification-code.ts') as {
  DOLPHIN_VERIFICATION_SUBJECT: string
  GMAIL_READONLY_SCOPE: string
  createGmailClient(): unknown
  createGmailOAuthUrl(options?: { clientId?: string; clientSecret?: string; redirectUri?: string }): string
  extractVerificationCode(body: string): string | null
  isDolphinVerificationEmail(email: any): boolean
  latestVerificationCode(emails: any[], options?: { now?: number; maxAgeMs?: number }): any
  toVerificationEmail(message: any): any
}

function gmailData(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function email(overrides: Partial<{ from: string; subject: string; body: string; receivedAt: number }> = {}) {
  return {
    from: overrides.from ?? 'Dolphin{anty} <no-reply@dolphin-anty.com>',
    subject: overrides.subject ?? DOLPHIN_VERIFICATION_SUBJECT,
    body: overrides.body ?? `${DOLPHIN_VERIFICATION_SUBJECT}\nEnter code from the email: 123 456`,
    receivedAt: overrides.receivedAt ?? Date.now()
  }
}

function runTests(): void {
  assert.equal(isDolphinVerificationEmail(email()), true)
  assert.equal(isDolphinVerificationEmail(email({ from: 'not-dolphin@example.com' })), false)
  assert.equal(isDolphinVerificationEmail(email({ subject: 'Welcome to Dolphin' })), false)
  assert.equal(isDolphinVerificationEmail(email({ body: 'Your code is 123456' })), false)

  assert.equal(extractVerificationCode(`${DOLPHIN_VERIFICATION_SUBJECT}\nEnter code from the email: 123 456`), '123456')
  assert.equal(extractVerificationCode(`${DOLPHIN_VERIFICATION_SUBJECT}\nCode: 123456`), '123456')
  assert.equal(extractVerificationCode(`${DOLPHIN_VERIFICATION_SUBJECT}\n<div>Enter code from the email: <b>654 321</b></div>`), '654321')
  assert.equal(extractVerificationCode('no six digit code here'), null)

  const now = Date.UTC(2026, 5, 17, 10, 0, 0)
  assert.deepEqual(latestVerificationCode([
    email({ body: `${DOLPHIN_VERIFICATION_SUBJECT}\nCode: 111 111`, receivedAt: now - 50_000 }),
    email({ body: `${DOLPHIN_VERIFICATION_SUBJECT}\nCode: 222222`, receivedAt: now - 10_000 }),
    email({ body: `${DOLPHIN_VERIFICATION_SUBJECT}\nCode: 333333`, receivedAt: now - 700_000 })
  ], { now, maxAgeMs: 600_000 }), {
    ok: true,
    code: '222222',
    receivedAt: new Date(now - 10_000).toISOString(),
    ageMs: 10_000
  })
  assert.equal(latestVerificationCode([
    email({ body: `${DOLPHIN_VERIFICATION_SUBJECT}\nCode: 333333`, receivedAt: now - 700_000 })
  ], { now, maxAgeMs: 600_000 }), null)

  const parsed = toVerificationEmail({
    internalDate: String(now - 5_000),
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Dolphin{anty} <no-reply@dolphin-anty.com>' },
        { name: 'Subject', value: DOLPHIN_VERIFICATION_SUBJECT }
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: gmailData(`${DOLPHIN_VERIFICATION_SUBJECT}\nEnter code from the email: 987 654`) }
        },
        {
          mimeType: 'text/html',
          body: { data: gmailData(`<h1>${DOLPHIN_VERIFICATION_SUBJECT}</h1><p>Enter code from the email: <b>987 654</b></p>`) }
        }
      ]
    }
  })
  assert.equal(parsed.from, 'Dolphin{anty} <no-reply@dolphin-anty.com>')
  assert.equal(parsed.subject, DOLPHIN_VERIFICATION_SUBJECT)
  assert.equal(parsed.receivedAt, now - 5_000)
  assert.equal(isDolphinVerificationEmail(parsed), true)
  assert.equal(extractVerificationCode(parsed.body), '987654')

  const authUrl = createGmailOAuthUrl({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:4300/oauth2callback'
  })
  assert.match(authUrl, /accounts\.google\.com/)
  assert.match(authUrl, /access_type=offline/)
  assert.match(authUrl, /prompt=consent/)
  assert.match(decodeURIComponent(authUrl), new RegExp(GMAIL_READONLY_SCOPE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const previousEnv = {
    DOLPHIN_VERIFICATION_GMAIL_CLIENT_ID: process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_ID,
    DOLPHIN_VERIFICATION_GMAIL_CLIENT_SECRET: process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_SECRET,
    DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN: process.env.DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN,
    DOLPHIN_VERIFICATION_GMAIL_CLIENT_EMAIL: process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_EMAIL,
    DOLPHIN_VERIFICATION_GMAIL_PRIVATE_KEY: process.env.DOLPHIN_VERIFICATION_GMAIL_PRIVATE_KEY
  }
  try {
    process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_ID = 'client-id'
    delete process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_SECRET
    delete process.env.DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN
    delete process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_EMAIL
    delete process.env.DOLPHIN_VERIFICATION_GMAIL_PRIVATE_KEY
    assert.throws(
      () => createGmailClient(),
      (error: any) => {
        assert.equal(error.code, 'mailbox_setup_error')
        assert.match(error.message, /OAuth env needs client id, client secret, and refresh token/)
        return true
      }
    )
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

runTests()
console.log('dolphin verification code tests passed')
