const axios = require('axios')
const { getNocoConfig, nocoHeaders } = require('./config.ts') as {
  getNocoConfig(): { baseUrl: string; token: string }
  nocoHeaders(config?: { token: string }): Record<string, string>
}
const { isRetryableNocoRequest, nocoErrorCode, nocoRetryAfterMs, normalizeNocoError } =
  require('./error-policy.ts') as typeof import('./error-policy.ts')
const { createNocoRequestCoordinator, sharedNocoRequestCoordinator } =
  require('./request-coordinator.ts') as typeof import('./request-coordinator.ts')
const { createNocoRequestLimiter, sharedNocoRequestLimiter } =
  require('./request-limiter.ts') as {
    createNocoRequestLimiter(options?: any): NocoRequestLimiter
    sharedNocoRequestLimiter: NocoRequestLimiter
  }

type NocoRecord = Record<string, unknown> & { Id: number }
type RequestMethod = 'get' | 'post' | 'patch' | 'delete'
type RequestKind = 'read' | 'write'
type ReadOptions = { cacheTtlMs?: number; fresh?: boolean }
type Requester = (request: {
  method: RequestMethod
  url: string
  data?: unknown
  headers: Record<string, string>
  timeout: number
}) => Promise<{ data: unknown }>
type NocoRequestLimiter = {
  rateLimited(waitMs?: number): void
  schedule<T>(kind: RequestKind, action: () => Promise<T>): Promise<T>
  snapshot(): Record<string, unknown>
}
type NocoRequestCoordinator = ReturnType<typeof createNocoRequestCoordinator>
type NocoRetryContext = {
  method: RequestMethod
  endpoint: string
  attempt: number
  error: unknown
  code?: string
}
type NocoRetryDecision = { retry: boolean; delayMs?: number }
type NocoRetryPolicy = (context: NocoRetryContext) => NocoRetryDecision
type NocoPhysicalAttempt = {
  method: RequestMethod
  endpoint: string
  attempt: number
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableNocoError(error: any, method: RequestMethod = 'get'): boolean {
  return isRetryableNocoRequest(error, method)
}

/** Backward-compatible helper. Missing or unusable Retry-After means 30 seconds. */
function retryAfterMs(error: any): number {
  const parsed = nocoRetryAfterMs(error)
  return parsed && parsed > 0 ? parsed : 30_000
}

function createNocoClient(options: {
  requester?: Requester
  retryDelaysMs?: number[]
  requestTimeoutMs?: number
  pageDelayMs?: number
  readCacheTtlMs?: number
  limiter?: NocoRequestLimiter
  coordinator?: NocoRequestCoordinator
  retryPolicy?: NocoRetryPolicy
  maxAutomaticRetries?: number
  onPhysicalAttempt?: (attempt: NocoPhysicalAttempt) => void
} = {}) {
  const config = getNocoConfig()
  const requester: Requester = options.requester ?? (request => axios.request(request))
  const retryDelaysMs = options.retryDelaysMs?.length
    ? options.retryDelaysMs.map(value => Math.max(0, Number(value) || 0))
    : [0, 2_500]
  const maxAutomaticRetries = Math.max(0, options.maxAutomaticRetries ??
    (options.retryDelaysMs ? retryDelaysMs.length - 1 : 1))
  const requestTimeoutMs = options.requestTimeoutMs ?? 60_000
  const pageDelayMs = options.pageDelayMs ?? 0
  const readCacheTtlMs = options.readCacheTtlMs ?? (options.requester ? 0 : 15_000)
  const limiter = options.limiter ?? (options.requester
    ? createNocoRequestLimiter({ maxRequestsPerBatch: Number.MAX_SAFE_INTEGER, log() {} })
    : sharedNocoRequestLimiter)
  const coordinator = options.coordinator ?? (options.requester
    ? createNocoRequestCoordinator({ cacheTtlMs: 0 })
    : sharedNocoRequestCoordinator)
  const createStrategy = new Map<string, number>()
  const patchStrategy = new Map<string, number>()

  function defaultRetryDecision(context: NocoRetryContext): NocoRetryDecision {
    if (context.method === 'post' || context.attempt > maxAutomaticRetries ||
      !isRetryableNocoRequest(context.error, context.method)) {
      return { retry: false }
    }
    if (context.code === 'noco_rate_limited') return { retry: true, delayMs: 0 }
    const delay = retryDelaysMs[Math.min(context.attempt, retryDelaysMs.length - 1)] ?? 0
    return { retry: true, delayMs: delay }
  }

  async function execute<T>(
    method: RequestMethod,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    let failedAttempts = 0
    while (true) {
      try {
        options.onPhysicalAttempt?.({ method, endpoint, attempt: failedAttempts + 1 })
        const response = await limiter.schedule(method === 'get' ? 'read' : 'write', () =>
          requester({
            method,
            url: `${config.baseUrl}${endpoint}`,
            data: body,
            headers: nocoHeaders(config),
            timeout: requestTimeoutMs
          }))
        return response.data as T
      } catch (error: any) {
        failedAttempts += 1
        const code = nocoErrorCode(error)
        const context: NocoRetryContext = {
          method,
          endpoint,
          attempt: failedAttempts,
          error,
          ...(code ? { code } : {})
        }
        // POST is never repeated automatically, even if a custom policy asks for it.
        const decision = method === 'post'
          ? { retry: false }
          : (options.retryPolicy?.(context) ?? defaultRetryDecision(context))
        if (!decision.retry) throw normalizeNocoError(error)
        const delayMs = Math.max(0, Number(decision.delayMs) || 0)
        if (delayMs) await wait(delayMs)
      }
    }
  }

  async function request<T>(
    method: RequestMethod,
    endpoint: string,
    body?: unknown,
    readOptions: ReadOptions = {}
  ): Promise<T> {
    const loader = () => execute<T>(method, endpoint, body)
    if (method === 'get') {
      const key = `${config.baseUrl}\u0000${config.token}\u0000${endpoint}`
      return coordinator.read(key, loader, {
        cacheTtlMs: readOptions.cacheTtlMs ?? readCacheTtlMs,
        fresh: readOptions.fresh
      })
    }
    return coordinator.mutate(loader)
  }

  async function fetchTableMeta(tableId: string, readOptions: ReadOptions = {}): Promise<any> {
    return request('get', `/api/v2/meta/tables/${tableId}`, undefined, readOptions)
  }

  async function fetchRecords(
    tableId: string,
    limit = 1_000,
    query: Record<string, string | number> = {},
    readOptions: ReadOptions = {}
  ): Promise<NocoRecord[]> {
    const all: NocoRecord[] = []
    const pageSize = Math.min(Math.max(limit, 1), 100)
    const queryString = Object.entries(query)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')

    for (let offset = 0; ; offset += pageSize) {
      const data = await request<any>(
        'get',
        `/api/v2/tables/${tableId}/records?limit=${pageSize}&offset=${offset}${queryString ? `&${queryString}` : ''}`,
        undefined,
        readOptions
      )
      const rows: NocoRecord[] = Array.isArray(data) ? data
        : Array.isArray(data?.list) ? data.list
          : Array.isArray(data?.data) ? data.data
            : (() => { throw Object.assign(new Error('NocoDB records response is invalid.'), {
              code: 'noco_response_invalid'
            }) })()
      all.push(...rows)

      if ((!Array.isArray(data) && data.pageInfo?.isLastPage) || rows.length < pageSize) return all
      if (pageDelayMs) await wait(pageDelayMs)
    }
  }

  async function createRecord(tableId: string, record: Record<string, unknown>): Promise<unknown> {
    const attempts = [
      { endpoint: `/api/v2/tables/${tableId}/records`, body: record },
      { endpoint: `/api/v2/tables/${tableId}/records`, body: [record] }
    ]
    let lastError: any
    const preferred = createStrategy.get(tableId)
    const order = preferred === undefined
      ? attempts.map((_attempt, index) => index)
      : [preferred, ...attempts.map((_attempt, index) => index).filter(index => index !== preferred)]

    for (const index of order) {
      const attempt = attempts[index]
      try {
        const value = await request('post', attempt.endpoint, attempt.body)
        createStrategy.set(tableId, index)
        return value
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        if (![400, 404, 405, 422].includes(status)) throw error
        if (createStrategy.get(tableId) === index) createStrategy.delete(tableId)
      }
    }
    throw lastError ?? new Error(`Failed to create record in table ${tableId}.`)
  }

  async function patchRecord(
    tableId: string,
    recordId: number,
    patch: Record<string, unknown>
  ): Promise<unknown> {
    const payload = { Id: recordId, ...patch }
    const attempts = [
      { endpoint: `/api/v2/tables/${tableId}/records`, body: payload },
      { endpoint: `/api/v2/tables/${tableId}/records`, body: [payload] },
      { endpoint: `/api/v2/tables/${tableId}/records/${recordId}`, body: patch }
    ]
    let lastError: any
    const preferred = patchStrategy.get(tableId)
    const order = preferred === undefined
      ? attempts.map((_attempt, index) => index)
      : [preferred, ...attempts.map((_attempt, index) => index).filter(index => index !== preferred)]

    for (const index of order) {
      const attempt = attempts[index]
      try {
        const value = await request('patch', attempt.endpoint, attempt.body)
        patchStrategy.set(tableId, index)
        return value
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        if (![400, 404, 405, 422].includes(status)) throw error
        if (patchStrategy.get(tableId) === index) patchStrategy.delete(tableId)
      }
    }
    throw lastError ?? new Error(`Failed to patch record ${recordId} in table ${tableId}.`)
  }

  async function deleteRecord(tableId: string, recordId: number): Promise<unknown> {
    const attempts = [
      { endpoint: `/api/v2/tables/${tableId}/records`, body: { Id: recordId } },
      { endpoint: `/api/v2/tables/${tableId}/records`, body: [{ Id: recordId }] }
    ]
    let lastError: any

    for (const attempt of attempts) {
      try {
        return await request('delete', attempt.endpoint, attempt.body)
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        const message = String(error?.response?.data?.message ?? error?.response?.data?.msg ?? '')
        if (status === 404 && /not found/i.test(message)) {
          return { ok: true, alreadyDeleted: true }
        }
        if (![400, 404, 405, 422].includes(status)) throw error
      }
    }
    throw lastError ?? new Error(`Failed to delete record ${recordId} in table ${tableId}.`)
  }

  return {
    config,
    createRecord,
    deleteRecord,
    fetchRecords,
    fetchTableMeta,
    patchRecord,
    request,
    queueStatus: limiter.snapshot,
    wait
  }
}

module.exports = {
  createNocoClient,
  isRetryableNocoError,
  retryAfterMs,
  wait
}
export type { NocoPhysicalAttempt, NocoRetryContext, NocoRetryDecision, NocoRetryPolicy, ReadOptions }
