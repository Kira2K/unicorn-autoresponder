const { LinkedInAuthError, safeErrorCode } = require('../../features/linkedin-automation/account-connection/errors.ts') as {
  LinkedInAuthError: new (code: string, message: string,
    details?: Record<string, string | number>) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}
const { safeUnipileDiagnostics } = require('./error-diagnostics.ts') as
  typeof import('./error-diagnostics.ts')

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<any>
type RequestOptions = { noCache?: boolean; fullRetryAfter?: boolean;
  onResponse?: UnipileResponseObserver }

export type UnipileResponseMetadata = {
  httpStatus: number
  providerCache?: 'HIT' | 'MISS' | 'STALE' | 'BYPASS' | 'EXPIRED' | 'REVALIDATED' | 'UNKNOWN'
  providerCacheAgeSeconds?: number
}
export type UnipileResponseObserver = (metadata: UnipileResponseMetadata) => void | Promise<void>

// Only diagnostic cache metadata is exposed. No URLs, bodies, cookies or arbitrary headers.
function observeUnipileResponse(response: any, observer?: UnipileResponseObserver) {
  if (!observer) return
  try {
    const cache = String(response?.headers?.get?.('x-cache') ?? '').trim().toUpperCase()
    const rawAge = String(response?.headers?.get?.('age') ?? '').trim()
    const age = /^\d+$/.test(rawAge) ? Number(rawAge) : NaN
    const metadata: UnipileResponseMetadata = { httpStatus: Number(response.status),
      ...(cache ? { providerCache: (['HIT', 'MISS', 'STALE', 'BYPASS', 'EXPIRED', 'REVALIDATED']
        .includes(cache) ? cache : 'UNKNOWN') as UnipileResponseMetadata['providerCache'] } : {}),
      ...(Number.isSafeInteger(age) ? { providerCacheAgeSeconds: age } : {}) }
    Promise.resolve(observer(metadata)).catch(() => undefined)
  } catch { /* Diagnostics must never change a request's outcome. */ }
}

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
    requestOptions: RequestOptions & { expectedStatus?: number } = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: any
    let text: string
    const multipart = body instanceof FormData

    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          'X-API-KEY': apiKey,
          ...(requestOptions.noCache ? { 'Cache-Control': 'no-cache' } : {})
        },
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      })
      observeUnipileResponse(response, requestOptions.onResponse)
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
    if (requestOptions.expectedStatus !== undefined && response.status !== requestOptions.expectedStatus)
      throw new LinkedInAuthError('unipile_unexpected_status',
        `Unipile returned unexpected HTTP ${response.status}.`, { httpStatus: response.status })
    return data as T
  }

  return { request }
}

module.exports = { createUnipileHttpClient, unipileApiKey }
