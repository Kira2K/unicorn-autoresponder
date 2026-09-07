import { createRequire } from 'node:module'
const load = createRequire(import.meta.url)
const { assertAccountOperational, verifiedIdentity } = load('../account-connection/account-validation.ts') as {
  assertAccountOperational(account: any): void
  verifiedIdentity(account: any, profile: any, target: any): any
}
import { connectionError } from './errors.ts'
import { connectionCount } from './limits.ts'
import type { ConnectionAccountContext, ConnectionRun } from './types.ts'
import type { ConnectionRuntime } from './runtime.ts'

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

export async function verifyConnectionAccount(runtime: ConnectionRuntime, run: ConnectionRun) {
  const remote = await runtime.adapter().getAccount(run.accountId)
  assertAccountOperational(remote)
  const profile = await runtime.adapter().getOwnProfile(run.accountId)
  const context = await resolveContext(runtime, run.platformAccountId)
  verifiedIdentity(remote, profile, { expectedLinkedInUrl: context.linkedinUrl,
    verifiedProviderId: context.verifiedProviderId })
  const count = connectionCount(profile)
  if (count === undefined) throw connectionError('connection_count_unavailable',
    'LinkedIn did not return a usable connection count.')
  return count
}
