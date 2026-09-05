import assert from 'node:assert/strict'
import { withCatalogRetry } from '../generation/catalog-retry.ts'

const error429 = () => Object.assign(new Error('limited'), {
  code: 'unipile_api_too_many_requests', details: { httpStatus: 429, retryAfterMs: 10 }
})

async function run() {
  const events: any[] = []; const waits: number[] = []; let calls = 0
  const value = await withCatalogRetry(async () => {
    calls += 1
    if (calls === 1) throw error429()
    return 'ok'
  }, { logger: { event: (...args: any[]) => events.push(args) },
    sleep: async milliseconds => { waits.push(milliseconds) }, random: () => 0.5 })
  assert.equal(value, 'ok'); assert.equal(calls, 2); assert.deepEqual(waits, [10])
  calls = 0; waits.length = 0
  await withCatalogRetry(async () => {
    calls += 1
    if (calls === 1) throw error429()
    return 'ok'
  }, { logger: { event() {} }, sleep: async milliseconds => { waits.push(milliseconds) },
    random: () => 0 })
  assert.deepEqual(waits, [10], 'Retry-After is a minimum and must not receive negative jitter')
  calls = 0
  await assert.rejects(withCatalogRetry(async () => {
    calls += 1; throw error429()
  }, { logger: { event() {} }, sleep: async () => undefined, random: () => 0.5 }),
  (error: any) => error.retryExhausted === true)
  assert.equal(calls, 4)
  assert(events.some(event => event[0] === 'unipile_retry_scheduled'))

  calls = 0
  const recoveredFrom500 = await withCatalogRetry(async () => {
    calls += 1
    if (calls === 1) throw Object.assign(new Error('temporary provider failure'), {
      code: 'unipile_api_internal_error', details: { httpStatus: 500 }
    })
    return 'ok'
  }, { logger: { event() {} }, sleep: async () => undefined, random: () => 0.5 })
  assert.equal(recoveredFrom500, 'ok')
  assert.equal(calls, 2)
}

run().then(() => console.log('catalog retry tests passed')).catch(error => {
  console.error(error); process.exitCode = 1
})
