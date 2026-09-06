const assert = require('node:assert/strict')
const { createUnipileHttpClient } = require('../../../../integrations/unipile/http-client.ts') as {
  createUnipileHttpClient(options: any): { request(method: string, path: string): Promise<any> }
}

const response = () => ({ ok: false, status: 429,
  headers: { get(name: string) { return name.toLowerCase() === 'retry-after' ? '3600' : null } },
  async text() { return JSON.stringify({ type: 'api_too_many_requests' }) } })

async function failure(cap?: number) {
  const client = createUnipileHttpClient({ apiKey: 'test', baseUrl: 'https://example.invalid',
    ...(cap === undefined ? {} : { retryAfterCapMs: cap }), fetchImpl: async () => response() })
  try { await client.request('GET', '/test') } catch (error) { return error as any }
  throw new Error('Expected the mock request to fail.')
}

Promise.all([failure(), failure(Number.POSITIVE_INFINITY)]).then(([shared, connection]) => {
  assert.equal(shared.details.retryAfterMs, 120_000)
  assert.equal(connection.details.retryAfterMs, 3_600_000)
  console.log('connection Retry-After HTTP option tests passed')
}).catch((error: unknown) => { console.error(error); process.exitCode = 1 })
