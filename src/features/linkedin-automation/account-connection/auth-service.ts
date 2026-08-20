const { LinkedInAuthError, getAuthErrorCode, safeErrorCode } = require('./errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
  getAuthErrorCode(error: unknown): string
  safeErrorCode(value: unknown, fallback?: string): string
}
const {
  assertAccountOperational,
  assertAccountShape,
  classicConnectionStatus,
  verifiedIdentity
} = require('./account-validation.ts') as Record<string, (...args: any[]) => any>

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount

type AuthDependencies = {
  repository: any
  adapter: any
  collectSession(profileId: number, expectedUrl: string): Promise<any>
  inspectProfile(profileId: number): Promise<any>
}

async function verifyAndStore(target: Target, account: Account, dependencies: AuthDependencies) {
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

async function authenticate(target: Target, dependencies: AuthDependencies) {
  const { proxy, session } = await dependencies.collectSession(
    target.dolphinProfileId,
    target.expectedLinkedInUrl
  )
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

async function runLinkedInAuth(input: {
  clientName: string
  platformAccountId?: number
  apply: boolean
  forceReauth?: boolean
}, dependencies: AuthDependencies) {
  await dependencies.repository.assertSchema()
  const target: Target = await dependencies.repository.resolveTarget(
    input.clientName, input.platformAccountId
  )
  if (!input.apply) {
    const inspected = await dependencies.inspectProfile(target.dolphinProfileId)
    return { mode: 'dry-run', target: { ...target, verifiedProviderId: undefined }, proxy: inspected.summary }
  }

  let knownStatus = target.unipileAccountStatus
  try {
    if (target.unipileAccountId && !input.forceReauth) {
      const current: Account = await dependencies.adapter.getAccount(target.unipileAccountId)
      assertAccountShape(current)
      knownStatus = current.status
      const classicStatus = classicConnectionStatus(current)
      if (classicStatus === 'running') {
        return { mode: 'verified', ...(await verifyAndStore(target, current, dependencies)) }
      }
      if (classicStatus === 'errored') assertAccountOperational(current)
    }
    const account = await authenticate(target, dependencies)
    knownStatus = account.status
    return { mode: target.unipileAccountId ? 'reconnected' : 'connected', ...(await verifyAndStore(target, account, dependencies)) }
  } catch (error: unknown) {
    await dependencies.repository.recordFailure(target.platformAccountId, {
      errorCode: getAuthErrorCode(error), accountStatus: knownStatus
    }).catch(() => undefined)
    throw error
  }
}

module.exports = { runLinkedInAuth }
