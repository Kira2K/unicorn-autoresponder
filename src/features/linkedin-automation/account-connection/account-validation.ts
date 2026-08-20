const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { assertLinkedInIdentity, canonicalLinkedInProfileUrl } = require('./profile-url.ts') as {
  assertLinkedInIdentity(expected: string, actual: string): string
  canonicalLinkedInProfileUrl(identifier: string): string
}

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount
type Profile = import('./types.ts').UnipileOwnProfile

function classicConnectionStatus(account: Account): string {
  return account.metadata?.products_connection_status?.classic ?? account.status
}

function assertAccountShape(account: Account): void {
  if (account.provider !== 'linkedin') {
    throw new LinkedInAuthError('unipile_provider_mismatch', 'Unipile account is not LinkedIn.')
  }
  if (account.is_locked) {
    throw new LinkedInAuthError('unipile_account_locked', 'Unipile account API access is locked.')
  }
}

function assertAccountOperational(account: Account): void {
  assertAccountShape(account)
  const status = classicConnectionStatus(account)
  if (status !== 'running') {
    throw new LinkedInAuthError(
      `unipile_classic_${status || 'unknown'}`,
      `Unipile LinkedIn Classic product is ${status || 'unknown'}.`
    )
  }
}

function verifiedIdentity(account: Account, profile: Profile, target: Target) {
  const publicIdentifier = String(
    profile.public_identifier ?? (profile as any).publicIdentifier ?? ''
  ).trim()
  if (!publicIdentifier) {
    throw new LinkedInAuthError(
      'unipile_profile_identifier_missing',
      'Unipile own profile has no public identifier.'
    )
  }
  const normalizedIdentifier = assertLinkedInIdentity(target.expectedLinkedInUrl, publicIdentifier)
  const providerId = String(profile.provider_id ?? profile.id ?? account.user_id ?? '').trim()
  if (!providerId) {
    throw new LinkedInAuthError('unipile_provider_id_missing', 'Unipile own profile has no provider ID.')
  }
  if (target.verifiedProviderId && target.verifiedProviderId !== providerId) {
    throw new LinkedInAuthError(
      'linkedin_provider_id_mismatch',
      'The LinkedIn provider ID differs from the previously verified owner.'
    )
  }

  const profileUrl = String(profile.public_profile_url ?? profile.profile_url ?? '').trim() ||
    canonicalLinkedInProfileUrl(normalizedIdentifier)
  const profileName = String(profile.name ?? '').trim() ||
    [profile.first_name, profile.last_name].map(value => String(value ?? '').trim()).filter(Boolean).join(' ')
  return { profileName, profileUrl, providerId, publicIdentifier: normalizedIdentifier }
}

module.exports = {
  assertAccountOperational,
  assertAccountShape,
  classicConnectionStatus,
  verifiedIdentity
}
