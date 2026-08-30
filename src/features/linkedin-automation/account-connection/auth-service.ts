const { getAuthErrorCode } = require('./errors.ts') as {
  getAuthErrorCode(error: unknown): string
}
const {
  assertAccountShape,
  assertAccountOperational,
  classicConnectionStatus
} = require('./account-validation.ts') as Record<string, (...args: any[]) => any>
const { authenticate, verifyAndStore } = require('./auth-account.ts') as {
  authenticate(...args: any[]): Promise<any>
  verifyAndStore(...args: any[]): Promise<any>
}
const { NOOP_AUTH_LOGGER } = require('./auth-logger.ts') as {
  NOOP_AUTH_LOGGER: import('./auth-logger.ts').AuthLogger
}

type Target = import('./types.ts').LinkedInAuthTarget
type Account = import('./types.ts').UnipileAccount
type AuthDependencies = import('./types.ts').LinkedInAuthDependencies

async function runLinkedInAuth(input: {
  clientName: string
  platformAccountId?: number
  apply: boolean
  forceReauth?: boolean
}, dependencies: AuthDependencies) {
  const logger = dependencies.logger ?? NOOP_AUTH_LOGGER
  const mode: 'dry-run' | 'apply' | 'force-reauth' = !input.apply
    ? 'dry-run'
    : input.forceReauth ? 'force-reauth' : 'apply'
  logger.event('run_started', 'started', { mode })
  await logger.run('noco_checked', { mode }, () => dependencies.repository.assertSchema())
  const target: Target = await logger.run(
    'target_resolved', { mode }, () => dependencies.repository.resolveTarget(
      input.clientName, input.platformAccountId
    )
  )
  const targetDetails = {
    mode,
    clientId: target.clientId,
    platformAccountId: target.platformAccountId,
    dolphinProfileId: target.dolphinProfileId,
    existingAccount: Boolean(target.unipileAccountId)
  }
  logger.event('target_summary', 'succeeded', targetDetails)
  if (!input.apply) {
    const inspected = await logger.run(
      'proxy_validated', targetDetails,
      () => dependencies.inspectProfile(target.dolphinProfileId)
    )
    logger.event('proxy_summary', 'succeeded', {
      ...targetDetails,
      dolphinProtocol: inspected.summary.protocol,
      authenticated: inspected.summary.authenticated
    })
    return { mode: 'dry-run', target: { ...target, verifiedProviderId: undefined }, proxy: inspected.summary }
  }

  let knownStatus = target.unipileAccountStatus
  try {
    if (target.unipileAccountId && !input.forceReauth) {
      const current: Account = await logger.run(
        'unipile_account_read', targetDetails,
        () => dependencies.adapter.getAccount(target.unipileAccountId as string)
      )
      assertAccountShape(current)
      knownStatus = current.status
      const classicStatus = classicConnectionStatus(current)
      if (classicStatus === 'running') {
        return {
          mode: 'verified',
          ...(await verifyAndStore(target, current, dependencies, logger))
        }
      }
      if (classicStatus === 'errored') assertAccountOperational(current)
    }
    const account = await authenticate(target, dependencies, logger)
    knownStatus = account.status
    return {
      mode: target.unipileAccountId ? 'reconnected' : 'connected',
      ...(await verifyAndStore(target, account, dependencies, logger))
    }
  } catch (error: unknown) {
    await dependencies.repository.recordFailure(target.platformAccountId, {
      errorCode: getAuthErrorCode(error), accountStatus: knownStatus
    }).catch(() => undefined)
    throw error
  }
}

module.exports = { runLinkedInAuth }
