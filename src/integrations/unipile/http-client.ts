const { LinkedInAuthError, safeErrorCode } = require('../../features/linkedin-automation/account-connection/errors.ts') as {
  LinkedInAuthError: new (code: string, message: string,
    details?: Record<string, string | number>) => Error
  safeErrorCode(value: unknown, fallback?: string): string
}
const { safeUnipileDiagnostics } = require('./error-diagnostics.ts') as
  typeof import('./error-diagnostics.ts')

type FetchLike = (url: string, init: Record<string, unknown>) => Promise<any>
const { readRateLimitHeaders, createUnipileRequestBudget, sharedUnipileRequestBudget } =
  require('./request-budget.ts') as typeof import('./request-budget.ts')
type RequestOptions = { noCache?: boolean; fullRetryAfter?: boolean;
  requiredReads?: string[];
  onResponse?: (details: import('./request-budget.ts').RateLimitDetails & { httpStatus: number }) => void }

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
  requestBudget?: ReturnType<typeof createUnipileRequestBudget>
} = {}) {
  const apiKey = options.apiKey ?? unipileApiKey()
  const baseUrl = String(
    options.baseUrl ?? process.env.UNIPILE_API_BASE_URL ?? 'https://api.unipile.com/v2'
  ).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const retryAfterCapMs = options.retryAfterCapMs ?? 120_000
  const budget = options.requestBudget ?? (options.fetchImpl ? createUnipileRequestBudget() : sharedUnipileRequestBudget)

  async function request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown,
    requestOptions: RequestOptions = {}): Promise<T> {
    const cooldown = budget.before(baseUrl, path, method) ?? requestOptions.requiredReads
      ?.map(read => budget.before(baseUrl, read, 'GET')).find(Boolean)
    if (cooldown) throw new LinkedInAuthError('unipile_api_too_many_requests',
      'A required Unipile method is in cooldown. No request was sent.',
      { httpStatus: 429, ...cooldown })
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

    const rateLimit = readRateLimitHeaders(response)
    budget.observe(baseUrl, path, response.status, rateLimit, method)
    requestOptions.onResponse?.({ httpStatus: response.status, ...rateLimit })

    let data: any
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const remoteCode = safeErrorCode(data?.type ?? data?.code, `http_${response.status}`)
      const requestId = safeErrorCode(data?.req_id, '')
      const retryDelay = rateLimit.retryAfterMs === undefined ? undefined : Math.min(rateLimit.retryAfterMs,
        requestOptions.fullRetryAfter ? Number.POSITIVE_INFINITY : retryAfterCapMs)
      throw new LinkedInAuthError(
        `unipile_${remoteCode}`,
        `Unipile request failed with HTTP ${response.status} (${remoteCode}).` +
        (requestId ? ` Request ID: ${requestId}.` : ''),
        { ...safeUnipileDiagnostics(response.status, data), ...rateLimit, requestSent: 1,
          ...(retryDelay !== undefined ? { retryAfterMs: retryDelay } : {}) }
      )
    }
    return data as T
  }

  return { request }
}

module.exports = { createUnipileHttpClient, unipileApiKey }
