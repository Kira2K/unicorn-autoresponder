import { PostError, object } from './errors.ts'
import { fullRetryAfter } from './openai-client.ts'
import type { Log } from './types.ts'
import * as configModule from '../../../integrations/noco/core/config.ts'
import * as limiterModule from '../../../integrations/noco/core/request-limiter.ts'
import { commonJsExports } from './commonjs-exports.ts'
const { getNocoConfig, nocoHeaders } = commonJsExports<{
  getNocoConfig(): { baseId: string; baseUrl: string; token: string }
  nocoHeaders(config: { token: string }): Record<string, string>
}>(configModule)
const { sharedNocoRequestLimiter } = commonJsExports<{
  sharedNocoRequestLimiter: { schedule<T>(kind: 'read' | 'write', fn: () => Promise<T>): Promise<T>
    rateLimited(ms: number): void }
}>(limiterModule)
export type NocoTransport = ReturnType<typeof createPostNocoTransport>
export function createPostNocoTransport(log: Log, fetchImpl = fetch) {
  const config = getNocoConfig()
  async function request(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<unknown> {
    return sharedNocoRequestLimiter.schedule(method === 'GET' ? 'read' : 'write', async () => {
      const started = Date.now()
      const response = await fetchImpl(config.baseUrl + path, { method,
        headers: { ...nocoHeaders(config), ...(method === 'GET' ? { 'Cache-Control': 'no-cache' } : {}) },
        signal: AbortSignal.timeout(60_000),
        body: body === undefined ? undefined : JSON.stringify(body) })
      log('noco_request', { method, status: response.status, durationMs: Date.now() - started })
      if (!response.ok) {
        const delay = fullRetryAfter(response.headers.get('retry-after'))
        if (response.status === 429) sharedNocoRequestLimiter.rateLimited(delay ?? 30_000)
        throw new PostError('post_noco_error', delay, response.status)
      }
      return response.status === 204 ? null : response.json()
    })
  }
  async function records(table: string, where?: string) {
    const rows: Record<string, unknown>[] = []
    for (let offset = 0; ; offset += 100) {
      const query = new URLSearchParams({ limit: '100', offset: String(offset), ...(where ? { where } : {}) })
      const page = object(await request('GET', `/api/v2/tables/${table}/records?${query}`))
      if (!Array.isArray(page.list)) throw new PostError('post_noco_invalid_page')
      rows.push(...page.list.map(object))
      if ((page.pageInfo as { isLastPage?: boolean })?.isLastPage || page.list.length < 100) return rows
    }
  }
  return { baseId: config.baseId, request, records }
}
