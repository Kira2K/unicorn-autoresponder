const { LinkedInAuthError, getAuthErrorCode, safeErrorCode } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
  getAuthErrorCode(value: unknown): string
  safeErrorCode(value: unknown, fallback?: string): string
}
const {
  assertAccountOperational,
  verifiedIdentity
} = require('./account-validation.ts') as Record<string, (...args: any[]) => any>
const { findExistingLinkedInAccount } = require('./existing-account.ts') as {
  findExistingLinkedInAccount(target: any, adapter: any, logger: any): Promise<any>
}

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount
type AuthIntentResult = import('./types.ts').UnipileAuthIntentResult
type AuthCheckpoint = import('./types.ts').AuthenticationCheckpoint
type Dependencies = import('./types.ts').LinkedInAuthDependencies
type AuthLogger = import('./auth-logger.ts').AuthLogger

async function verifyAndStore(
  target: Target,
  account: Account,
  dependencies: Dependencies,
  logger: AuthLogger
) {
  assertAccountOperational(account)
  const details = { platformAccountId: target.platformAccountId }
  const profile = await logger.run(
    'unipile_owner_profile_read', details,
    () => dependencies.adapter.getOwnProfile(account.id)
  )
  const identity = verifiedIdentity(account, profile, target)
  await logger.run('noco_connection_saved', details, () =>
    dependencies.repository.recordSuccess(target.platformAccountId, {
      accountId: account.id,
      accountStatus: account.status,
      ...identity
    })
  )
  return { accountId: account.id, accountStatus: account.status, ...identity }
}

async function authenticate(target: Target, dependencies: Dependencies, logger: AuthLogger) {
  const { proxy, session } = await dependencies.collectSession(
    target.dolphinProfileId, target.expectedLinkedInUrl, logger
  )
  logger.event('pre_api_ready', 'succeeded', {
    dolphinProfileId: target.dolphinProfileId,
    platformAccountId: target.platformAccountId,
    dolphinProtocol: proxy.protocol,
    unipileProtocol: dependencies.unipileProxyProtocol?.(proxy) ?? proxy.protocol,
    cookiePresent: true,
    userAgentPresent: true,
    ownerMatched: true
  })
  const details = { platformAccountId: target.platformAccountId }
  const input = {
    liAt: session.liAt, userAgent: session.userAgent, proxy,
    accountId: target.unipileAccountId,
    state: `platform_account:${target.platformAccountId}`
  }
  let result: AuthIntentResult
  try {
    result = await logger.run(
      'unipile_authentication', details,
      () => dependencies.adapter.authenticateLinkedIn(input)
    )
  } catch (error: unknown) {
    if (target.unipileAccountId || getAuthErrorCode(error) !== 'unipile_api_already_exists') {
      throw error
    }
    const existing = await findExistingLinkedInAccount(target, dependencies.adapter, logger)
    if (existing.status === 'running') return existing
    result = await logger.run(
      'unipile_reauthentication', details,
      () => dependencies.adapter.authenticateLinkedIn({ ...input, accountId: existing.id })
    )
  }
  if (result.object === 'AuthenticationCheckpoint') {
    const type = safeErrorCode((result as AuthCheckpoint).checkpoint?.type, 'unknown')
    throw new LinkedInAuthError(
      `unipile_checkpoint_${type}`,
      `Unipile requires checkpoint ${type}. Restore the LinkedIn session in Dolphin and retry.`
    )
  }
  return result as Account
}

module.exports = { authenticate, verifyAndStore }
