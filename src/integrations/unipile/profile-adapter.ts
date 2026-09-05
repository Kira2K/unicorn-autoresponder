type JsonObject = import('../../features/linkedin-automation/profile-filler/input-types.ts').JsonObject
type CatalogType = import('../../features/linkedin-automation/profile-filler/mcp-contract.ts').CatalogType

const { createUnipileHttpClient } = require('./http-client.ts') as {
  createUnipileHttpClient(options?: any): {
    request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown,
      options?: { noCache?: boolean; fullRetryAfter?: boolean }): Promise<T>
  }
}
const { createUnipileRequestScheduler } = require('./request-scheduler.ts') as
  typeof import('./request-scheduler.ts')

function createUnipileProfileAdapter(http = createUnipileHttpClient(), options: any = {}) {
  const scheduler = options.scheduler ?? createUnipileRequestScheduler(options.schedulerOptions)
  const parameterCache = new Map<string, { expiresAt: number; request: Promise<any[]> }>()
  const parameterCacheTtlMs = options.parameterCacheTtlMs ?? 60 * 60_000
  const now = options.now ?? Date.now

  async function searchParameters(accountId: string, type: CatalogType, keywords: string) {
    const cacheKey = [accountId, type, keywords.normalize('NFKC').trim().toLowerCase()].join(':')
    const cached = parameterCache.get(cacheKey)
    if (cached && cached.expiresAt > now()) return cached.request
    if (cached) parameterCache.delete(cacheKey)
    const request = scheduler.run(async () => {
      const query = new URLSearchParams({ type, keywords, limit: '25' })
      const response: JsonObject = await http.request<JsonObject>('GET',
        `/${encodeURIComponent(accountId)}/linkedin/search/parameters?${query.toString()}`,
        undefined, { fullRetryAfter: true })
      if (!Array.isArray(response.data)) return []
      return response.data.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const row = item as JsonObject
        const id = String(row.id ?? '').trim()
        const name = String(row.name ?? '').trim()
        return id && name ? [{ id, name }] : []
      })
    })
    parameterCache.set(cacheKey, { expiresAt: now() + parameterCacheTtlMs, request })
    try { return await request }
    catch (error) { parameterCache.delete(cacheKey); throw error }
  }

  return {
    getAccount(accountId: string) {
      return http.request<JsonObject>('GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    getOwnProfile(accountId: string, sections: string[] = [], options: { fresh?: boolean } = {}) {
      const query = new URLSearchParams({ variant: 'linkedin_classic' })
      sections.forEach(section => query.append('with_sections', section))
      return http.request<JsonObject>('GET',
        `/${encodeURIComponent(accountId)}/users/me?${query.toString()}`, undefined,
        { noCache: options.fresh === true, fullRetryAfter: true })
    },
    updateOwnProfile(accountId: string, payload: JsonObject) {
      return http.request<JsonObject>('PATCH', `/${encodeURIComponent(accountId)}/users/me`, payload,
        { fullRetryAfter: true })
    },
    searchParameters
  }
}

module.exports = { createUnipileProfileAdapter }
