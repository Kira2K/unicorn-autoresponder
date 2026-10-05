const { LinkedInAuthError, safeErrorCode } = require('../../features/linkedin-automation/account-connection/errors.ts') as {
  LinkedInAuthError: new (code: string, message: string,
    details?: Record<string, string | number>) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}
const { safeUnipileDiagnostics } = require('./error-diagnostics.ts') as
  typeof import('./error-diagnostics.ts')
const { requestInfo, runRequest, requestFailed, requestSucceeded, requestDispatched } = require('./request-control.ts')

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

function retryAfterMs(response: any, now: number) {
  const value = String(response?.headers?.get?.('retry-after') ?? '').trim()
  if (!value) return undefined
  const seconds = Number(value)
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined
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

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown,
    requestOptions: RequestOptions & { expectedStatus?: number } = {}): Promise<T> {
    const info = requestInfo(method, path, body)
    // Queue and permission checks remain outside the transport catch; no POST has started yet.
    return runRequest(info, () => send<T>(info, method, path, body, requestOptions))
  }

  async function send<T>(info: import('./request-control.ts').RequestInfo, method: string, path: string,
    body: unknown, requestOptions: RequestOptions & { expectedStatus?: number }): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: any
    let text: string
    const multipart = body instanceof FormData

    try {
      const init = {
        method,
        headers: {
          Accept: 'application/json',
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
          'X-API-KEY': apiKey,
          ...(requestOptions.noCache ? { 'Cache-Control': 'no-cache' } : {})
        },
        body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      }
      // Record the actual transport invocation, after permission checks. Always drain
      // the request even if its dispatch audit fails; the provider outcome still matters.
      let dispatched: Promise<void> | undefined
      let pending: Promise<any>
      try { pending = fetchImpl(`${baseUrl}${path}`, init) }
      finally { dispatched = requestDispatched(info).catch(() => undefined) }
      try { response = await pending! } finally { await dispatched }
      observeUnipileResponse(response, requestOptions.onResponse)
      text = await response.text()
    } catch (error: any) {
      const code = error?.name === 'AbortError' ? 'unipile_timeout' : 'unipile_unreachable'
      const failure = new LinkedInAuthError(code, `Unipile request failed before receiving a response.`)
      await requestFailed(info, failure).catch(() => undefined); throw failure
    } finally {
      clearTimeout(timer)
    }

    let data: any
    let bodyFormat: 'non_json' | 'empty' | undefined = text ? undefined : 'empty'
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
      bodyFormat = 'non_json'
    }

    if (!response.ok) {
      const remoteCode = safeErrorCode(data?.type ?? data?.code, `http_${response.status}`)
      const diagnostics = safeUnipileDiagnostics(response.status, data,
        { requestPath: path, requestBody: body, secrets: [apiKey], bodyFormat })
      // Legacy cap/fullRetryAfter options remain accepted, but cannot shorten a provider deadline.
      const observedAt = Date.now()
      const providerDelay = retryAfterMs(response, observedAt)
      // A failed POST remains ambiguous. Delay reconciliation, never retry the POST here.
      const retryDelay = providerDelay ?? ([500, 502, 503, 504].includes(response.status) ? 5 * 60_000 : undefined)
      const error = new LinkedInAuthError(
        `unipile_${remoteCode}`,
        `Unipile request failed with HTTP ${response.status} (${remoteCode}).` +
        (diagnostics.requestId ? ` Request ID: ${diagnostics.requestId}.` : ''),
        { ...diagnostics, observedAt, ...(info.stage ? { requestStage: info.stage } : {}),
          ...(retryDelay !== undefined ? { retryAfterMs: retryDelay, retryAt: observedAt + retryDelay,
            retryAfterSource: providerDelay === undefined ? 'fallback' : 'provider' } : {}) }
      )
      await requestFailed(info, error).catch(() => undefined)
      throw error
    }
    if (requestOptions.expectedStatus !== undefined && response.status !== requestOptions.expectedStatus) {
      const error = new LinkedInAuthError('unipile_unexpected_status',
        `Unipile returned unexpected HTTP ${response.status}.`, { httpStatus: response.status })
      await requestFailed(info, error).catch(() => undefined); throw error
    }
    // The policy fences future work on audit failure. Do not replace a known ID
    // or the provider's original error/deadline with that secondary SQL failure.
    await requestSucceeded(info, response.status).catch(() => undefined)
    return data as T
  }

  return { request }
}

module.exports = { createUnipileHttpClient, unipileApiKey }
