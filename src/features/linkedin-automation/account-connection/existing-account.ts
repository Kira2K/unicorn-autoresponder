const { LinkedInAuthError } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
}
const { assertLinkedInIdentity, linkedInPublicIdentifier } = require('./profile-url.ts') as {
  assertLinkedInIdentity(expected: string, actual: string): string
  linkedInPublicIdentifier(value: unknown): string
}

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount
type Logger = import('./auth-logger.ts').AuthLogger

function nameKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function likelyAccount(account: Account, target: Target): boolean {
  if (target.verifiedProviderId && account.user_id === target.verifiedProviderId) return true
  const slug = nameKey(linkedInPublicIdentifier(target.expectedLinkedInUrl))
  const name = nameKey(account.name)
  return Boolean(name && (name === slug || name.startsWith(slug) || slug.startsWith(name)))
}

function profileIdentifier(profile: Record<string, unknown>): string {
  return String(
    profile.public_identifier ?? profile.public_profile_url ?? profile.profile_url ?? ''
  )
}

async function findExistingLinkedInAccount(
  target: Target,
  adapter: any,
  logger: Logger
): Promise<Account> {
  const details = { platformAccountId: target.platformAccountId }
  const accounts: Account[] = await logger.run(
    'unipile_accounts_listed', details, () => adapter.listAccounts()
  )
  const linkedIn = accounts.filter(account => account.provider === 'linkedin')
  const ordered = [
    ...linkedIn.filter(account => likelyAccount(account, target)),
    ...linkedIn.filter(account => !likelyAccount(account, target))
  ]
  for (const account of ordered) {
    const profile: Record<string, unknown> = await logger.run(
      'unipile_existing_owner_checked', details,
      () => adapter.getOwnProfile(account.id)
    )
    try {
      assertLinkedInIdentity(target.expectedLinkedInUrl, profileIdentifier(profile))
      return account
    } catch (error: any) {
      if (error?.code !== 'linkedin_profile_mismatch') throw error
    }
  }
  throw new LinkedInAuthError(
    'unipile_existing_account_not_found',
    'Unipile reported an existing account, but no verified owner matched the LinkedIn URL.'
  )
}

module.exports = { findExistingLinkedInAccount, likelyAccount }
