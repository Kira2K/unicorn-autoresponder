type JsonObject = import('../../features/linkedin-automation/profile-filler/input-types.ts').JsonObject

const { createUnipileHttpClient } = require('./http-client.ts') as {
  createUnipileHttpClient(options?: any): {
    request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T>
  }
}

function createUnipileProfileAdapter(http = createUnipileHttpClient()) {
  return {
    getAccount(accountId: string) {
      return http.request<JsonObject>('GET', `/accounts/${encodeURIComponent(accountId)}`)
    },
    getOwnProfile(accountId: string, sections: string[] = []) {
      const query = new URLSearchParams({ variant: 'linkedin_classic' })
      sections.forEach(section => query.append('with_sections', section))
      return http.request<JsonObject>('GET',
        `/${encodeURIComponent(accountId)}/users/me?${query.toString()}`)
    },
    updateOwnProfile(accountId: string, payload: JsonObject) {
      return http.request<JsonObject>('PATCH', `/${encodeURIComponent(accountId)}/users/me`, payload)
    },
    async searchParameters(accountId: string,
      type: 'JOB_TITLE' | 'LOCATION' | 'COMPANY' | 'SKILL' | 'EMPLOYMENT_TYPE', keywords: string) {
      const query = new URLSearchParams({ type, keywords, limit: '25' })
      const response = await http.request<JsonObject>('GET',
        `/${encodeURIComponent(accountId)}/linkedin/search/parameters?${query.toString()}`)
      if (!Array.isArray(response.data)) return []
      return response.data.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const row = item as JsonObject
        const id = String(row.id ?? '').trim()
        const name = String(row.name ?? '').trim()
        return id && name ? [{ id, name }] : []
      })
    }
  }
}

module.exports = { createUnipileProfileAdapter }
