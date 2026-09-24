import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
const { assertAccountOperational, verifiedIdentity } = load('../account-connection/account-validation.ts') as {
  assertAccountOperational(account: any): void
  verifiedIdentity(account: any, profile: any, target: any): any
}
import { connectionError } from './errors.ts'
import { connectionCount } from './limits.ts'
import type { ConnectionAccountContext, ConnectionRun } from './types.ts'
import type { ConnectionRuntime, SaveRun } from './runtime.ts'
import { withConnectionRetry } from './retry-state.ts'

export function accountContext(row: any): ConnectionAccountContext {
  if (!row) throw connectionError('linkedin_account_not_found', 'LinkedIn account was not found.')
  if (!row.unipileAccountId || row.unipileAccountStatus !== 'running' || !row.lastVerifiedAt) {
    throw connectionError('connection_inviter_auth_required', 'Verify or reconnect LinkedIn first.')
  }
  return {
    platformAccountId: Number(row.platformAccountId), clientId: Number(row.clientId),
    clientName: String(row.clientName), linkedinUrl: String(row.linkedinUrl),
    accountId: String(row.unipileAccountId), accountStatus: row.unipileAccountStatus,
    verifiedProviderId: row.verifiedProviderId, lastVerifiedAt: row.lastVerifiedAt,
    ...(Number(row.primaryStackId) > 0 ? { stackId: Number(row.primaryStackId) } : {}),
    ...(String(row.primaryStack ?? '').trim() ? { stack: String(row.primaryStack).trim() } : {})
  }
}

export async function resolveContext(runtime: ConnectionRuntime, platformAccountId: number) {
  return accountContext((await runtime.repository.listAccounts()).find((row: any) =>
    Number(row.platformAccountId) === platformAccountId))
}

// V2 may omit relations_count even on a valid own profile. Count the actual
// bidirectional relations; followers and an old run's count are not substitutes.
async function readConnectionCount(runtime: ConnectionRuntime, run: ConnectionRun, save: SaveRun) {
  const adapter = runtime.adapter()
  if (!adapter.listRelations) throw connectionError('connection_count_unavailable',
    'LinkedIn connection list is unavailable.')
  const listRelations = adapter.listRelations.bind(adapter)
  const ids = new Set<string>(), cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 1; page <= 500; page++) {
    if (runtime.stopRequested(run.runId)) throw connectionError('connection_stop_requested',
      'Connection run stop was requested.')
    const result = await withConnectionRetry(runtime, run, save, 'unipile',
      'connection_count_read', () => listRelations(run.accountId, cursor)) as any
    const rows = result?.data
    const next = result?.next_cursor
    if (!Array.isArray(rows) || (next != null && typeof next !== 'string') ||
      rows.some((row: any) => typeof row?.user?.id !== 'string' || !row.user.id.trim())) break
    for (const row of rows) ids.add(row.user.id)
    if (!next) {
      runtime.logger.event('connection_count_read', 'succeeded', {
        runId: run.runId, platformAccountId: run.platformAccountId,
        connectionCount: ids.size, page, reasonCode: 'complete_relations_fallback' })
      return ids.size
    }
    if (!rows.length || cursors.has(next)) break
    cursors.add(next); cursor = next
  }
  throw connectionError('connection_count_unavailable',
    'LinkedIn did not return a complete usable connection list.')
}

export async function verifyConnectionAccount(runtime: ConnectionRuntime, run: ConnectionRun,
  save: SaveRun = async () => undefined) {
  let remote = await withConnectionRetry(runtime, run, save, 'unipile', 'account_verification',
    () => runtime.adapter().getAccount(run.accountId))
  assertAccountOperational(remote)
  let checkedAt = runtime.now().getTime()
  const context = await withConnectionRetry(runtime, run, save, 'storage', 'account_context_read',
    () => resolveContext(runtime, run.platformAccountId))
  if (context.accountId !== run.accountId) {
    throw connectionError('connection_account_changed', 'LinkedIn account binding changed.')
  }
  const cached = run.searchProgress.verifiedAccount
  if (cached && cached.accountId === run.accountId && cached.providerId === remote.user_id &&
    cached.providerId === context.verifiedProviderId && cached.lastVerifiedAt === context.lastVerifiedAt &&
    Number.isFinite(run.connectionCount) && run.dailyQuota !== undefined &&
    run.audienceQuota.recruiter + run.audienceQuota.technical > 0) {
    return run.connectionCount!
  }
  const profile = await withConnectionRetry(runtime, run, save, 'unipile', 'own_profile_verification',
    async () => {
      if (runtime.now().getTime() - checkedAt > 5 * 60_000) {
        remote = await runtime.adapter().getAccount(run.accountId)
        assertAccountOperational(remote); checkedAt = runtime.now().getTime()
      }
      return runtime.adapter().getOwnProfile(run.accountId)
    })
  const identity = verifiedIdentity(remote, profile, { expectedLinkedInUrl: context.linkedinUrl,
    verifiedProviderId: context.verifiedProviderId })
  if (remote.user_id && remote.user_id !== identity.providerId) {
    throw connectionError('linkedin_provider_id_mismatch', 'Account owner and profile owner differ.')
  }
  const count = connectionCount(profile) ?? await readConnectionCount(runtime, run, save)
  run.searchProgress.verifiedAccount = { accountId: run.accountId, providerId: identity.providerId,
    lastVerifiedAt: context.lastVerifiedAt! }
  return count
}
