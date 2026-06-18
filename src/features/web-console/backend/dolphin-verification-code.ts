const { google } = require('googleapis')

type GmailHeader = {
  name?: string
  value?: string
}

type GmailMessagePart = {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailMessagePart[]
}

type GmailMessage = {
  id?: string
  internalDate?: string
  payload?: GmailMessagePart & { headers?: GmailHeader[] }
}

type VerificationEmail = {
  from: string
  subject: string
  body: string
  receivedAt: number
}

type VerificationCodeResult = {
  ok: true
  code: string
  receivedAt: string
  ageMs: number
}

type VerificationCodeNotFound = Error & {
  code: 'code_not_found'
}

type MailboxSetupError = Error & {
  code: 'mailbox_setup_error'
}

const DOLPHIN_VERIFICATION_SENDER = 'no-reply@dolphin-anty.com'
const DOLPHIN_VERIFICATION_SUBJECT = 'Suspicious Attempt to Access Your Account'
const DEFAULT_VERIFICATION_CODE_MAX_AGE_MS = 600_000
const DEFAULT_GMAIL_USER = 'kind.cute.unicorn@gmail.com'
const DEFAULT_OAUTH_REDIRECT_URI = 'http://localhost:4300/oauth2callback'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function senderEmail(value: string): string {
  const angleMatch = value.match(/<([^>]+)>/)
  return normalizeEmail(angleMatch?.[1] ?? value)
}

function headerValue(headers: GmailHeader[] = [], name: string): string {
  const normalized = name.toLowerCase()
  return headers.find(header => String(header.name ?? '').toLowerCase() === normalized)?.value ?? ''
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
}

function textFromGmailPart(part?: GmailMessagePart): string {
  if (!part) return ''
  const ownText = part.body?.data ? decodeBase64Url(part.body.data) : ''
  const text = part.mimeType === 'text/html' ? stripHtml(ownText) : ownText
  const childText = (part.parts ?? []).map(textFromGmailPart).join('\n')
  return [text, childText].filter(Boolean).join('\n')
}

function toVerificationEmail(message: GmailMessage): VerificationEmail {
  const headers = message.payload?.headers ?? []
  return {
    from: headerValue(headers, 'from'),
    subject: headerValue(headers, 'subject'),
    body: textFromGmailPart(message.payload),
    receivedAt: Number(message.internalDate ?? 0)
  }
}

function isDolphinVerificationEmail(email: VerificationEmail): boolean {
  return senderEmail(email.from) === DOLPHIN_VERIFICATION_SENDER &&
    email.subject.includes(DOLPHIN_VERIFICATION_SUBJECT) &&
    email.body.includes(DOLPHIN_VERIFICATION_SUBJECT)
}

function extractVerificationCode(body: string): string | null {
  const labeled = body.match(/(?:code|код)[^\d]{0,40}(\d{3})\s?(\d{3})/i)
  const generic = body.match(/\b(\d{3})\s?(\d{3})\b/)
  const match = labeled ?? generic
  return match ? `${match[1]} ${match[2]}` : null
}

function createCodeNotFoundError(): VerificationCodeNotFound {
  const error = new Error('No fresh Dolphin verification code was found.') as VerificationCodeNotFound
  error.code = 'code_not_found'
  return error
}

function createMailboxSetupError(message: string): MailboxSetupError {
  const error = new Error(message) as MailboxSetupError
  error.code = 'mailbox_setup_error'
  return error
}

function latestVerificationCode(
  emails: VerificationEmail[],
  options: { now?: number; maxAgeMs?: number } = {}
): VerificationCodeResult | null {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_VERIFICATION_CODE_MAX_AGE_MS
  const matches = emails
    .filter(isDolphinVerificationEmail)
    .map(email => ({ email, code: extractVerificationCode(email.body) }))
    .filter((entry): entry is { email: VerificationEmail; code: string } => Boolean(entry.code))
    .filter(entry => now - entry.email.receivedAt >= 0 && now - entry.email.receivedAt <= maxAgeMs)
    .sort((a, b) => b.email.receivedAt - a.email.receivedAt)

  const latest = matches[0]
  if (!latest) return null

  return {
    ok: true,
    code: latest.code,
    receivedAt: new Date(latest.email.receivedAt).toISOString(),
    ageMs: now - latest.email.receivedAt
  }
}

function resolveMaxAgeMs(): number {
  return Number(process.env.DOLPHIN_VERIFICATION_CODE_MAX_AGE_MS ?? DEFAULT_VERIFICATION_CODE_MAX_AGE_MS)
}

function createOAuthClient(options: {
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  refreshToken?: string
} = {}) {
  const clientId = String(options.clientId ?? process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_ID ?? '').trim()
  const clientSecret = String(options.clientSecret ?? process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_SECRET ?? '').trim()
  const redirectUri = String(options.redirectUri ?? process.env.DOLPHIN_VERIFICATION_GMAIL_REDIRECT_URI ?? DEFAULT_OAUTH_REDIRECT_URI).trim()
  if (!clientId || !clientSecret || !redirectUri) {
    throw createMailboxSetupError('Dolphin verification Gmail OAuth client id/secret are not configured.')
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  const refreshToken = String(options.refreshToken ?? process.env.DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN ?? '').trim()
  if (refreshToken) auth.setCredentials({ refresh_token: refreshToken })
  return auth
}

function createGmailOAuthUrl(options: { clientId?: string; clientSecret?: string; redirectUri?: string } = {}): string {
  const auth = createOAuthClient(options)
  return auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GMAIL_READONLY_SCOPE]
  })
}

async function exchangeGmailOAuthCode(code: string, options: { clientId?: string; clientSecret?: string; redirectUri?: string } = {}) {
  const auth = createOAuthClient(options)
  const result = await auth.getToken(code)
  return result.tokens
}

function createGmailClient() {
  const oauthClientId = String(process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_ID ?? '').trim()
  const oauthClientSecret = String(process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_SECRET ?? '').trim()
  const oauthRefreshToken = String(process.env.DOLPHIN_VERIFICATION_GMAIL_REFRESH_TOKEN ?? '').trim()
  if (oauthClientId || oauthClientSecret || oauthRefreshToken) {
    if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken) {
      throw createMailboxSetupError('Dolphin verification Gmail OAuth env needs client id, client secret, and refresh token.')
    }
    return google.gmail({ version: 'v1', auth: createOAuthClient() })
  }

  const clientEmail = String(process.env.DOLPHIN_VERIFICATION_GMAIL_CLIENT_EMAIL ?? '').trim()
  const privateKey = String(process.env.DOLPHIN_VERIFICATION_GMAIL_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim()
  const user = String(process.env.DOLPHIN_VERIFICATION_GMAIL_USER ?? DEFAULT_GMAIL_USER).trim()

  if (!clientEmail || !privateKey || !user) {
    throw createMailboxSetupError('Dolphin verification Gmail credentials are not configured.')
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [GMAIL_READONLY_SCOPE],
    subject: user
  })
  return google.gmail({ version: 'v1', auth })
}

function createMockVerificationCodeService() {
  return {
    async getLatestCode(): Promise<VerificationCodeResult> {
      return {
        ok: true,
        code: '123 456',
        receivedAt: new Date(Date.now() - 30_000).toISOString(),
        ageMs: 30_000
      }
    }
  }
}

function createGmailVerificationCodeService(options: { gmail?: any; maxAgeMs?: number; now?: () => number } = {}) {
  const maxAgeMs = options.maxAgeMs ?? resolveMaxAgeMs()
  const now = options.now ?? (() => Date.now())

  return {
    async getLatestCode(): Promise<VerificationCodeResult> {
      const gmail = options.gmail ?? createGmailClient()
      const list = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 10,
        q: `from:${DOLPHIN_VERIFICATION_SENDER} subject:"${DOLPHIN_VERIFICATION_SUBJECT}" newer_than:1d`
      })
      const ids = (list.data.messages ?? []).map((message: { id?: string }) => message.id).filter(Boolean)
      const messages = await Promise.all(ids.map((id: string) => gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full'
      })))
      const emails = messages.map((response: { data: GmailMessage }) => toVerificationEmail(response.data))
      const code = latestVerificationCode(emails, { now: now(), maxAgeMs })
      if (!code) throw createCodeNotFoundError()
      return code
    }
  }
}

function createDefaultVerificationCodeService() {
  return process.env.WEB_CONSOLE_USE_MOCK_DATA === 'true'
    ? createMockVerificationCodeService()
    : createGmailVerificationCodeService()
}

module.exports = {
  DEFAULT_VERIFICATION_CODE_MAX_AGE_MS,
  DEFAULT_GMAIL_USER,
  DEFAULT_OAUTH_REDIRECT_URI,
  DOLPHIN_VERIFICATION_SENDER,
  DOLPHIN_VERIFICATION_SUBJECT,
  GMAIL_READONLY_SCOPE,
  createCodeNotFoundError,
  createDefaultVerificationCodeService,
  createGmailClient,
  createGmailOAuthUrl,
  createGmailVerificationCodeService,
  createMailboxSetupError,
  createMockVerificationCodeService,
  createOAuthClient,
  decodeBase64Url,
  exchangeGmailOAuthCode,
  extractVerificationCode,
  isDolphinVerificationEmail,
  latestVerificationCode,
  senderEmail,
  stripHtml,
  textFromGmailPart,
  toVerificationEmail
}
