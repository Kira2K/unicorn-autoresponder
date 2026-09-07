const { LinkedInAuthError, safeErrorCode } = require('../../features/linkedin-automation/account-connection/errors.ts') as {
  LinkedInAuthError: new (code: string, message: string,
    details?: Record<string, string | number>) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}
const { safeUnipileDiagnostics } = require('./error-diagnostics.ts') as
  typeof import('./error-diagnostics.ts')

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<any>
type RequestOptions = { noCache?: boolean; fullRetryAfter?: boolean }

function retryAfterMs(response: any, capMs: number) {
  const value = String(response?.headers?.get?.('retry-after') ?? '').trim()
  if (!value) return undefined
  const seconds = Number(value)
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(capMs, milliseconds)) : undefined
}

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
  retryAfterCapMs?: number
} = {}) {
  const apiKey = options.apiKey ?? unipileApiKey()
  const baseUrl = String(
    options.baseUrl ?? process.env.UNIPILE_API_BASE_URL ?? 'https://api.unipile.com/v2'
  ).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const retryAfterCapMs = options.retryAfterCapMs ?? 120_000

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown,
    requestOptions: RequestOptions = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: any
    let text: string

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
          ...(requestOptions.noCache ? { 'Cache-Control': 'no-cache' } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
      text = await response.text()
    } catch (error: any) {
      const code = error?.name === 'AbortError' ? 'unipile_timeout' : 'unipile_unreachable'
      throw new LinkedInAuthError(code, `Unipile request failed before receiving a response.`)
    } finally {
      clearTimeout(timer)
    }

    let data: any
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const remoteCode = safeErrorCode(data?.type ?? data?.code, `http_${response.status}`)
      const requestId = safeErrorCode(data?.req_id, '')
      const retryDelay = retryAfterMs(response,
        requestOptions.fullRetryAfter ? Number.POSITIVE_INFINITY : retryAfterCapMs)
      throw new LinkedInAuthError(
        `unipile_${remoteCode}`,
        `Unipile request failed with HTTP ${response.status} (${remoteCode}).` +
        (requestId ? ` Request ID: ${requestId}.` : ''),
        { ...safeUnipileDiagnostics(response.status, data),
          ...(retryDelay !== undefined ? { retryAfterMs: retryDelay } : {}) }
      )
    }
    return data as T
  }

  return { request }
}

module.exports = { createUnipileHttpClient, unipileApiKey }
