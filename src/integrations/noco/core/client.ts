const axios = require('axios')
const { getNocoConfig, nocoHeaders } = require('./config.ts') as {
  getNocoConfig(): { baseUrl: string; token: string }
  nocoHeaders(config?: { token: string }): Record<string, string>
}
const { describeError } = require('./errors.ts') as {
  describeError(error: any): string
}
const { sharedNocoRequestLimiter } = require('./request-limiter.ts') as {
  sharedNocoRequestLimiter: NocoRequestLimiter
}

type NocoRecord = Record<string, unknown> & { Id: number }
type RequestMethod = 'get' | 'post' | 'patch' | 'delete'
type Requester = (request: {
  method: RequestMethod
  url: string
  data?: unknown
  headers: Record<string, string>
  timeout: number
}) => Promise<{ data: unknown }>
type NocoRequestLimiter = {
  rateLimited(waitMs?: number): void
  schedule<T>(kind: 'read' | 'write', action: () => Promise<T>): Promise<T>
  snapshot(): Record<string, unknown>
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRetryableNocoError(error: any): boolean {
  const status = error?.response?.status
  const message = describeError(error)
  return status === 429 || String(message).includes('Too Many Requests')
}

function retryAfterMs(error: any): number {
  const value = error?.response?.headers?.['retry-after']
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(String(value ?? ''))
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 30000
}

function createNocoClient(options: {
  requester?: Requester
  retryDelaysMs?: number[]
  requestTimeoutMs?: number
  pageDelayMs?: number
  limiter?: NocoRequestLimiter
} = {}) {
  const config = getNocoConfig()
  const requester: Requester =
    options.requester ??
    (request => axios.request(request))
  const retryDelaysMs = options.retryDelaysMs?.length
    ? options.retryDelaysMs
    : [0, 2500, 5000, 10000, 20000]
  const requestTimeoutMs = options.requestTimeoutMs ?? 60000
  const pageDelayMs = options.pageDelayMs ?? 0
  const limiter = options.limiter ?? sharedNocoRequestLimiter

  async function request<T>(
    method: RequestMethod,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    let attempt = 0
    while (true) {
      const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]
      if (delay) {
        await wait(delay)
      }

      try {
        const response = await limiter.schedule(method === 'get' ? 'read' : 'write', async () => {
          try {
            return await requester({
              method,
              url: `${config.baseUrl}${endpoint}`,
              data: body,
              headers: nocoHeaders(config),
              timeout: requestTimeoutMs
            })
          } catch (error: any) {
            if (isRetryableNocoError(error)) limiter.rateLimited(retryAfterMs(error))
            throw error
          }
        })
        return response.data as T
      } catch (error: any) {
        if (!isRetryableNocoError(error)) {
          throw error
        }
        attempt += 1
      }
    }
  }

  async function fetchTableMeta(tableId: string): Promise<any> {
    return request('get', `/api/v2/meta/tables/${tableId}`)
  }

  async function fetchRecords(tableId: string, limit = 1000, query: Record<string, string | number> = {}): Promise<NocoRecord[]> {
    const all: NocoRecord[] = []
    const pageSize = Math.min(Math.max(limit, 1), 100)
    const queryString = Object.entries(query)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&')

    for (let offset = 0; ; offset += pageSize) {
      const data = await request<{ list?: NocoRecord[]; data?: NocoRecord[]; pageInfo?: { isLastPage?: boolean } }>(
        'get',
        `/api/v2/tables/${tableId}/records?limit=${pageSize}&offset=${offset}${queryString ? `&${queryString}` : ''}`
      )
      const rows = data.list ?? data.data ?? []
      all.push(...rows)

      if (data.pageInfo?.isLastPage || rows.length < pageSize) {
        return all
      }
      if (pageDelayMs) await wait(pageDelayMs)
    }
  }

  async function createRecord(tableId: string, record: Record<string, unknown>): Promise<unknown> {
    const attempts = [
      { endpoint: `/api/v2/tables/${tableId}/records`, body: record },
      { endpoint: `/api/v2/tables/${tableId}/records`, body: [record] }
    ]
    let lastError: any

    for (const attempt of attempts) {
      try {
        return await request('post', attempt.endpoint, attempt.body)
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
          throw error
        }
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

    for (const attempt of attempts) {
      try {
        return await request('patch', attempt.endpoint, attempt.body)
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
          throw error
        }
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
        if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
          throw error
        }
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
