const { LinkedInAuthError, safeErrorCode } = require('../../features/linkedin-automation/account-connection/errors.ts') as {
  LinkedInAuthError: new (code: string, message: string) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<any>

function unipileApiKey(): string {
  const key = String(process.env.UNIPILE_API_KEY ?? '').trim()
  if (!key) {
    throw new LinkedInAuthError('unipile_api_key_missing', 'Missing UNIPILE_API_KEY.')
  }
  return key
}

function createUnipileHttpClient(options: {
  apiKey?: string
  baseUrl?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
} = {}) {
  const apiKey = options.apiKey ?? unipileApiKey()
  const baseUrl = String(
    options.baseUrl ?? process.env.UNIPILE_API_BASE_URL ?? 'https://api.unipile.com/v2'
  ).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: any

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
    } catch (error: any) {
      const code = error?.name === 'AbortError' ? 'unipile_timeout' : 'unipile_unreachable'
      throw new LinkedInAuthError(code, `Unipile request failed before receiving a response.`)
    } finally {
      clearTimeout(timer)
    }

    const text = await response.text()
    let data: any
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const remoteCode = safeErrorCode(data?.type ?? data?.code, `http_${response.status}`)
      const requestId = safeErrorCode(data?.req_id, '')
      throw new LinkedInAuthError(
        `unipile_${remoteCode}`,
        `Unipile request failed with HTTP ${response.status} (${remoteCode}).` +
        (requestId ? ` Request ID: ${requestId}.` : '')
      )
    }
    return data as T
  }

  return { request }
}

module.exports = { createUnipileHttpClient, unipileApiKey }
