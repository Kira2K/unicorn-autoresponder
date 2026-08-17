const { randomInt: cryptoRandomInt } = require('node:crypto') as typeof import('node:crypto')

type JsonObject = Record<string, unknown>

type ProxyConfig = {
  protocol: string
  host: string
  port: number
  username?: string
  password?: string
}

type LinkedInCredentials = {
  accessToken: string
  userAgent: string
}

type RateLimitSnapshot = {
  limit?: string
  remaining?: string
  reset?: string
  retryAfterSeconds?: number
  status: number
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  retryRateLimits?: boolean
}

type UnipileClientOptions = {
  apiKey: string
  baseUrl?: string
  fetchImpl?: typeof fetch
  wait?: (milliseconds: number) => Promise<void>
  randomInt?: (minimum: number, maximumExclusive: number) => number
  onRateLimit?: (snapshot: RateLimitSnapshot) => void
}

class UnipileApiError extends Error {
  readonly status: number
  readonly type?: string
  readonly title?: string
  readonly detail?: string
  readonly reqId?: string
  readonly retryAfterSeconds?: number
  readonly rateLimit?: RateLimitSnapshot

  constructor(options: {
    status: number
    type?: string
    title?: string
    detail?: string
    reqId?: string
    retryAfterSeconds?: number
    rateLimit?: RateLimitSnapshot
  }) {
    const label = [options.type, options.title, options.detail].filter(Boolean).join(': ')
    super(`Unipile HTTP ${options.status}${label ? `: ${label}` : ''}`)
    this.name = 'UnipileApiError'
    this.status = options.status
    this.type = options.type
    this.title = options.title
    this.detail = options.detail
    this.reqId = options.reqId
    this.retryAfterSeconds = options.retryAfterSeconds
    this.rateLimit = options.rateLimit
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeErrorField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.slice(0, 500)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000))
  return undefined
}

function readRateLimitSnapshot(response: Response): RateLimitSnapshot {
  return {
    limit: response.headers.get('x-ratelimit-limit') ?? undefined,
    remaining: response.headers.get('x-ratelimit-remaining') ?? undefined,
    reset: response.headers.get('x-ratelimit-reset') ?? undefined,
    retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
    status: response.status
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

class UnipileClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly randomInt: (minimum: number, maximumExclusive: number) => number
  private readonly onRateLimit?: (snapshot: RateLimitSnapshot) => void

  constructor(options: UnipileClientOptions) {
    if (!options.apiKey.trim()) throw new Error('Unipile API key is empty.')
    this.apiKey = options.apiKey.trim()
    this.baseUrl = (options.baseUrl ?? 'https://api.unipile.com/v2').replace(/\/$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
    this.randomInt = options.randomInt ?? cryptoRandomInt
    this.onRateLimit = options.onRateLimit
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET'
    const maxAttempts = options.retryRateLimits === false ? 1 : 3

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json; charset=utf-8',
          'X-API-KEY': this.apiKey
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      })
      const rateLimit = readRateLimitSnapshot(response)
      if (
        rateLimit.limit !== undefined ||
        rateLimit.remaining !== undefined ||
        rateLimit.reset !== undefined ||
        response.status === 429
      ) {
        this.onRateLimit?.(rateLimit)
      }
      const parsed = await parseResponseBody(response)
      if (response.ok) return parsed as T

      const errorBody = isObject(parsed) ? parsed : {}
      const error = new UnipileApiError({
        status: response.status,
        type: safeErrorField(errorBody.type),
        title: safeErrorField(errorBody.title),
        detail: safeErrorField(errorBody.detail),
        reqId: safeErrorField(errorBody.req_id),
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        rateLimit
      })

      if (
        response.status !== 429 ||
        error.type !== 'api/too_many_requests' ||
        error.retryAfterSeconds === undefined ||
        attempt === maxAttempts
      ) {
        throw error
      }
      const retrySeconds = error.retryAfterSeconds
      const safetyCushionSeconds = this.randomInt(5, 21)
      await this.wait((retrySeconds + safetyCushionSeconds) * 1000)
    }

    throw new Error('Unreachable Unipile request state.')
  }

  listAccounts(): Promise<{ data?: unknown[] }> {
    return this.request('/accounts/?provider=linkedin')
  }

  getAccount(accountId: string): Promise<JsonObject> {
    return this.request(`/accounts/${encodeURIComponent(accountId)}`)
  }

  async connectLinkedInSession(
    credentials: LinkedInCredentials,
    proxy?: ProxyConfig
  ): Promise<{ accountId: string; object: string }> {
    const config: JsonObject = { products: ['classic'] }
    if (proxy) config.custom_proxy = proxy
    const response = await this.request<JsonObject>('/auth/intent', {
      method: 'POST',
      body: {
        provider: 'linkedin',
        credentials: {
          access_token: credentials.accessToken,
          user_agent: credentials.userAgent
        },
        config
      }
    })
    const object = safeErrorField(response.object) ?? 'Unknown'
    const accountId = safeErrorField(response.id) ?? safeErrorField(response.account_id)
    if (object === 'Account' && accountId?.startsWith('acc_')) {
      return { accountId, object }
    }
    const checkpoint = isObject(response.checkpoint) ? safeErrorField(response.checkpoint.type) : undefined
    if (object === 'AuthenticationCheckpoint' || object === 'Checkpoint') {
      throw new Error(`LinkedIn authentication checkpoint required${checkpoint ? `: ${checkpoint}` : ''}.`)
    }
    throw new Error(`Unexpected Unipile authentication response: ${object}.`)
  }

  getOwnProfile(accountId: string, sections: string[] = []): Promise<JsonObject> {
    const query = new URLSearchParams({ variant: 'linkedin_classic' })
    sections.forEach(section => query.append('with_sections', section))
    return this.request(`/${encodeURIComponent(accountId)}/users/me?${query.toString()}`)
  }

  updateOwnProfile(accountId: string, payload: Record<string, unknown>): Promise<JsonObject | undefined> {
    return this.request(`/${encodeURIComponent(accountId)}/users/me`, {
      method: 'PATCH',
      body: payload
    })
  }

  async searchLinkedInParameters(
    accountId: string,
    type: 'JOB_TITLE' | 'LOCATION',
    keywords: string
  ): Promise<Array<{ id: string; name: string }>> {
    const query = new URLSearchParams({ type, keywords, limit: '25' })
    const response = await this.request<JsonObject>(
      `/${encodeURIComponent(accountId)}/linkedin/search/parameters?${query.toString()}`
    )
    if (!Array.isArray(response.data)) return []
    return response.data.flatMap(item => {
      if (!isObject(item)) return []
      const id = safeErrorField(item.id)
      const name = safeErrorField(item.name)
      return id && name ? [{ id, name }] : []
    })
  }
}

module.exports = {
  UnipileApiError,
  UnipileClient,
  parseRetryAfter
}

export type { ProxyConfig, RateLimitSnapshot, UnipileClientOptions }
