const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { assertLinkedInIdentity, linkedInPublicIdentifier } = require('./profile-url.ts') as {
  assertLinkedInIdentity(expected: string, actual: string): string
  linkedInPublicIdentifier(value: unknown): string
}

type BrowserCookie = {
  name?: string
  value?: string
  domain?: string
  expires?: number
}

function extractLinkedInSession(input: {
  cookies: BrowserCookie[]
  userAgent: string
  profileUrl: string
  expectedLinkedInUrl: string
  nowSeconds?: number
}) {
  const cookie = input.cookies.find(item =>
    item.name === 'li_at' && String(item.domain ?? '').replace(/^\./, '').endsWith('linkedin.com')
  )
  const nowSeconds = input.nowSeconds ?? Date.now() / 1000

  if (!cookie?.value || (Number(cookie.expires) > 0 && Number(cookie.expires) <= nowSeconds)) {
    throw new LinkedInAuthError(
      'linkedin_li_at_missing',
      'The En Dolphin profile has no active li_at cookie. Log in to LinkedIn there and retry.'
    )
  }
  if (!input.userAgent.trim()) {
    throw new LinkedInAuthError(
      'linkedin_user_agent_missing',
      'Could not read user_agent from the En Dolphin profile.'
    )
  }

  const publicIdentifier = assertLinkedInIdentity(input.expectedLinkedInUrl, input.profileUrl)
  return {
    liAt: cookie.value,
    userAgent: input.userAgent.trim(),
    profileUrl: input.profileUrl,
    publicIdentifier: publicIdentifier || linkedInPublicIdentifier(input.profileUrl)
  }
}

module.exports = { extractLinkedInSession }
