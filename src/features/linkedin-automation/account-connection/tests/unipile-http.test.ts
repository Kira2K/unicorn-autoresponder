const assert = require('node:assert/strict')
const { createUnipileHttpClient } = require('../../../../integrations/unipile/http-client.ts') as {
  createUnipileHttpClient(options: any): any
}

function response(ok: boolean, status: number, data: unknown) {
  return { ok, status, async text() { return JSON.stringify(data) } }
}

async function run(): Promise<void> {
  const requests: any[] = []
  const client = createUnipileHttpClient({
    apiKey: 'api-secret',
    baseUrl: 'https://unipile.test/v2',
    async fetchImpl(url: string, init: any) {
      requests.push({ url, init })
      return response(true, 200, { object: 'Account', id: 'acc_1' })
    }
  })
  const result = await client.request('POST', '/auth/intent', { access_token: 'li-at-secret' })
  assert.equal(result.id, 'acc_1')
  assert.equal(requests[0].url, 'https://unipile.test/v2/auth/intent')
  assert.equal(requests[0].init.headers['X-API-KEY'], 'api-secret')

  const failing = createUnipileHttpClient({
    apiKey: 'api-secret',
    async fetchImpl() {
      return response(false, 401, {
        type: 'provider/invalid_credentials', detail: 'li-at-secret proxy-secret',
        req_id: 'req_safe-123'
      })
    }
  })
  await assert.rejects(
    () => failing.request('POST', '/auth/intent', { access_token: 'li-at-secret' }),
    (error: any) => {
      assert.equal(error.code, 'unipile_provider_invalid_credentials')
      assert.equal(error.message.includes('li-at-secret'), false)
      assert.equal(error.message.includes('proxy-secret'), false)
      assert.equal(error.message.includes('req_safe-123'), true)
      return true
    }
  )
}

module.exports = { run }
