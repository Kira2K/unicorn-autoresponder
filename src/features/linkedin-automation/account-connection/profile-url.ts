const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}

function normalizeLinkedInHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '')
}

function linkedInPublicIdentifier(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) {
    throw new LinkedInAuthError(
      'linkedin_url_missing',
      'The LinkedIn platform account must contain linkedin_url.'
    )
  }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new LinkedInAuthError(
      'linkedin_url_invalid',
      'linkedin_url must be an absolute LinkedIn profile URL.'
    )
  }

  if (normalizeLinkedInHost(url.hostname) !== 'linkedin.com') {
    throw new LinkedInAuthError(
      'linkedin_url_invalid',
      'linkedin_url must point to linkedin.com.'
    )
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0]?.toLowerCase() !== 'in' || !segments[1]) {
    throw new LinkedInAuthError(
      'linkedin_url_invalid',
      'linkedin_url must use the /in/{publicIdentifier} profile format.'
    )
  }

  return decodeURIComponent(segments[1]).trim().toLowerCase()
}

function canonicalLinkedInProfileUrl(publicIdentifier: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(publicIdentifier)}/`
}

function assertLinkedInIdentity(expectedUrl: string, actualIdentifierOrUrl: string): string {
  const expected = linkedInPublicIdentifier(expectedUrl)
  const actualText = String(actualIdentifierOrUrl ?? '').trim()
  const actual = /^https?:\/\//i.test(actualText)
    ? linkedInPublicIdentifier(actualText)
    : actualText.toLowerCase()

  if (!actual || actual !== expected) {
    throw new LinkedInAuthError(
      'linkedin_profile_mismatch',
      `LinkedIn profile mismatch: expected ${expected}, received ${actual || 'unknown'}.`
    )
  }

  return expected
}

module.exports = {
  assertLinkedInIdentity,
  canonicalLinkedInProfileUrl,
  linkedInPublicIdentifier
}
