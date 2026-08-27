import { codedError } from './errors.ts'
import { logAction } from './log-action.ts'
import { CATALOG_TYPES, type CatalogType } from './mcp-contract.ts'
import type { ProfileClient } from './plan-types.ts'
import type { ProfileLogger } from './profile-logger.ts'
import { jobTitleQueries } from './generation/job-title-queries.ts'

const TYPES = new Set<string>(CATALOG_TYPES)
const unique = (items: Array<{ id: string; name: string }>) => [...new Map(
  items.map(item => [`${item.id}:${item.name.toLowerCase()}`, item])
).values()]

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
  let items = await logAction(logger, 'parameter_search', () =>
    client.searchParameters(row.unipileAccountId, type as CatalogType, keywords),
  { operation: type })
  if (type === 'JOB_TITLE') {
    for (const query of jobTitleQueries(keywords).slice(1)) {
      if (unique(items).length >= 8) break
      const found = await logAction(logger, 'parameter_search_fallback', () =>
        client.searchParameters(row.unipileAccountId, type, query), { operation: type })
      items = [...items, ...found]
    }
  }
  items = unique(items)
  return { type, items: items.slice(0, 8).map(item => ({ name: item.name })) }
}
