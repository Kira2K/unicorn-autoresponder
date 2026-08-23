const { LinkedInAuthError, safeErrorCode } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}
const {
  assertAccountOperational,
  verifiedIdentity
} = require('./account-validation.ts') as Record<string, (...args: any[]) => any>

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount
type Dependencies = import('./types.ts').LinkedInAuthDependencies
type AuthLogger = import('./auth-logger.ts').AuthLogger

async function verifyAndStore(target: Target, account: Account, dependencies: Dependencies) {
  assertAccountOperational(account)
  const profile = await dependencies.adapter.getOwnProfile(account.id)
  const identity = verifiedIdentity(account, profile, target)
  await dependencies.repository.recordSuccess(target.platformAccountId, {
    accountId: account.id,
    accountStatus: account.status,
    ...identity
  })
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
  const result = await dependencies.adapter.authenticateLinkedIn({
    liAt: session.liAt,
    userAgent: session.userAgent,
    proxy,
    accountId: target.unipileAccountId,
    state: `platform_account:${target.platformAccountId}`
  })
  if (result.object === 'AuthenticationCheckpoint') {
    const type = safeErrorCode(result.checkpoint?.type, 'unknown')
    throw new LinkedInAuthError(
      `unipile_checkpoint_${type}`,
      `Unipile requires checkpoint ${type}. Restore the LinkedIn session in Dolphin and retry.`
    )
  }
  return result as Account
}

module.exports = { authenticate, verifyAndStore }
