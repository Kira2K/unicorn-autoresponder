import { codedError } from './errors.ts'
import { logAction } from './log-action.ts'
import { CATALOG_TYPES, type CatalogType } from './mcp-contract.ts'
import type { ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'

const TYPES = new Set<string>(CATALOG_TYPES)

export async function findParameterOptions(options: {
  repository: any
  client: ProfileClient
  platformAccountId: number
  type: string
  keywords: string
  logger: ProfileLogger
}) {
  const { repository, client, platformAccountId, logger } = options
  const type = options.type.trim().toUpperCase()
  const keywords = options.keywords.trim()
  if (!TYPES.has(type) || keywords.length < 2 || keywords.length > 80) {
    throw codedError('profile_parameter_search_invalid', 'Invalid parameter search.')
  }
  const rows = await logAction(logger, 'parameter_account_list', () => repository.listAccounts())
  const row = rows.find((item: any) => Number(item.platformAccountId) === platformAccountId)
  if (!row) throw codedError('linkedin_account_not_found', 'LinkedIn account was not found.')
  if (!row.unipileAccountId || row.unipileAccountStatus !== 'running' || !row.lastVerifiedAt) {
    throw codedError('profile_filler_auth_required', 'Verify or reconnect LinkedIn first.')
  }
  const items = await logAction(logger, 'parameter_search', () =>
    client.searchParameters(row.unipileAccountId, type as CatalogType, keywords),
  { operation: type })
  return { type, items: items.slice(0, 8).map(item => ({ name: item.name })) }
}
