const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createNocoClient, isRetryableNocoError } = require('./client.ts') as {
  createNocoClient(options?: any): any
  isRetryableNocoError(error: any, method?: 'get' | 'post' | 'patch' | 'delete'): boolean
}
const { createNocoRequestLimiter } = require('./request-limiter.ts') as {
  createNocoRequestLimiter(options?: any): any
}
const { createNocoRequestCoordinator } = require('./request-coordinator.ts') as
  typeof import('./request-coordinator.ts')
const { nocoErrorCode, nocoRetryAfterMs } = require('./error-policy.ts') as
  typeof import('./error-policy.ts')
const { parseJobArgs } = require('./job.ts') as {
  parseJobArgs(args?: string[]): { mode: string; apply: boolean; dryRun: boolean; test: boolean }
}
const {
  buildLinkPayloads,
  formatLinkedRecordLabel,
  formatLinkedRelationLabel,
  getLinkedRecord,
  getLinkedRecordId,
  getLinkedRecords,
  noMigrationRefsEnabled,
  uniqueRelatedIds
} = require('./relations.ts') as {
  buildLinkPayloads(relatedIds: number[]): unknown[]
  formatLinkedRecordLabel(record: Record<string, unknown> | null | undefined): string
  formatLinkedRelationLabel(value: unknown): string
  getLinkedRecord(value: unknown): Record<string, unknown> | null
  getLinkedRecordId(value: unknown): number | null
  getLinkedRecords(value: unknown): Array<Record<string, unknown>>
  noMigrationRefsEnabled(): boolean
  uniqueRelatedIds(relatedIds: number[]): number[]
}
const { createMockRequester, createTempDir } = require('./test-utils.ts') as {
  createMockRequester(responses: Array<unknown | Error>): { calls: any[]; requester: any }
  createTempDir(prefix?: string): string
}
const { writeJson, writeText } = require('./reports.ts') as {
  writeJson(dir: string, fileName: string, data: unknown): void
  writeText(dir: string, fileName: string, content: string): void
}
const { normalizeLookupText, slugify, uniqueValue } = require('./text.ts') as {
  normalizeLookupText(value: unknown): string
  slugify(value: unknown): string
  uniqueValue(baseValue: string, usedValues: Set<string>): string
}

function httpError(status: number, message: string): Error {
  const error: any = new Error(message)
  error.response = { status, data: { message } }
  return error
}

async function runTests(): Promise<void> {
  await require('./request-limiter-regression.test.ts').testCompletedBatches()
  assert.deepEqual(parseJobArgs([]), {
    mode: 'dry-run',
    apply: false,
    dryRun: true,
    test: false
  })
  assert.equal(parseJobArgs(['--apply']).mode, 'apply')
  assert.equal(parseJobArgs(['--test']).mode, 'test')
  assert.throws(() => parseJobArgs(['--apply', '--dry-run']), /Use only one/)

  assert.equal(isRetryableNocoError(httpError(429, 'Too Many Requests')), true)
  assert.equal(isRetryableNocoError(httpError(400, 'Bad Request')), false)
  const timeout = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
  assert.equal(nocoErrorCode(timeout), 'noco_timeout')
  assert.equal(isRetryableNocoError(timeout, 'get'), true)
  assert.equal(isRetryableNocoError(timeout, 'post'), false)

  const limiterEvents: any[] = []
  const limiter = createNocoRequestLimiter({
    maxStarts: 10, windowMs: 25, cooldownMs: 25,
    log: (event: any) => limiterEvents.push(event)
  })
  const order: string[] = []
  await Promise.all([
    limiter.schedule('read', async () => { order.push('first') }),
    limiter.schedule('read', async () => { order.push('read') }),
    limiter.schedule('write', async () => { order.push('write') })
  ])
  assert.deepEqual(order, ['first', 'read', 'write'])
  assert.ok(limiterEvents.some(event => event.event === 'request_queued'))

  let limiterNow = 0
  const starts: number[] = []
  const completions: number[] = []
  const batchEvents: any[] = []
  const batchLimiter = createNocoRequestLimiter({
    maxRequestsPerBatch: 4,
    batchPauseMs: 100,
    now: () => limiterNow,
    sleep: async (milliseconds: number) => { limiterNow += milliseconds },
    log: (event: any) => batchEvents.push(event)
  })
  await Promise.all(Array.from({ length: 9 }, (_, index) =>
    batchLimiter.schedule('read', async () => {
      starts[index] = limiterNow
      if (index === 3) limiterNow += 1_500
      completions[index] = limiterNow
      return index
    })))
  assert.ok(starts[4] - completions[3] >= 100,
    'fifth request must wait after the fourth request settles')
  assert.ok(starts[8] - completions[7] >= 100,
    'ninth request must wait after the eighth request settles')
  assert.equal(batchEvents.filter(event => event.event === 'batch_pause_started').length, 2)

  let failedNow = 0
  const afterFailureStarts: number[] = []
  const failureLimiter = createNocoRequestLimiter({
    maxRequestsPerBatch: 4,
    batchPauseMs: 100,
    now: () => failedNow,
    sleep: async (milliseconds: number) => { failedNow += milliseconds },
    log() {}
  })
  const failedBatch = await Promise.allSettled(Array.from({ length: 5 }, (_, index) =>
    failureLimiter.schedule('read', async () => {
      afterFailureStarts[index] = failedNow
      if (index === 3) throw timeout
    })))
  assert.equal(failedBatch[3].status, 'rejected')
  assert.ok(afterFailureStarts[4] >= 100, 'failed physical attempt must count in the batch')

  const retryBase = Date.UTC(2026, 8, 1, 0, 0, 0)
  const fractional429: any = httpError(429, 'Too Many Requests')
  fractional429.response.headers = { 'retry-after': '0.025' }
  assert.equal(nocoRetryAfterMs(fractional429, retryBase), 25)
  const dated429: any = httpError(429, 'Too Many Requests')
  dated429.response.headers = {
    'Retry-After': new Date(retryBase + 180_000).toUTCString()
  }
  assert.equal(nocoRetryAfterMs(dated429, retryBase), 180_000)

  let cooldownNow = retryBase
  const cooldownStarts: number[] = []
  const cooldownLimiter = createNocoRequestLimiter({
    cooldownMs: 30_000,
    now: () => cooldownNow,
    sleep: async (milliseconds: number) => { cooldownNow += milliseconds },
    log() {}
  })
  await Promise.allSettled([
    cooldownLimiter.schedule('read', async () => { throw fractional429 }),
    cooldownLimiter.schedule('read', async () => { cooldownStarts.push(cooldownNow) })
  ])
  assert.equal(cooldownStarts[0], retryBase + 25)

  let fallbackNow = retryBase
  const fallbackStarts: number[] = []
  const fallbackLimiter = createNocoRequestLimiter({
    cooldownMs: 30_000,
    now: () => fallbackNow,
    sleep: async (milliseconds: number) => { fallbackNow += milliseconds },
    log() {}
  })
  await Promise.allSettled([
    fallbackLimiter.schedule('read', async () => { throw httpError(429, 'Too Many Requests') }),
    fallbackLimiter.schedule('read', async () => { fallbackStarts.push(fallbackNow) })
  ])
  assert.equal(fallbackStarts[0], retryBase + 30_000)

  let loads = 0
  let resolveLoad: ((value: { value: number }) => void) | undefined
  const coordinator = createNocoRequestCoordinator({ cacheTtlMs: 15_000 })
  const load = () => {
    loads += 1
    return new Promise<{ value: number }>(resolve => { resolveLoad = resolve })
  }
  const firstRead = coordinator.read('records', load)
  const joinedRead = coordinator.read('records', load)
  assert.equal(loads, 1)
  resolveLoad?.({ value: 1 })
  const [firstValue, joinedValue] = await Promise.all([firstRead, joinedRead])
  assert.deepEqual(firstValue, { value: 1 })
  assert.deepEqual(joinedValue, { value: 1 })
  firstValue.value = 99
  assert.deepEqual(await coordinator.read('records', async () => ({ value: 2 })), { value: 1 })
  assert.equal(loads, 1)
  assert.deepEqual(await coordinator.read('records', async () => {
    loads += 1
    return { value: 2 }
  }, { fresh: true }), { value: 2 })
  assert.equal(loads, 2)
  await coordinator.mutate(async () => ({ ok: true }))
  assert.deepEqual(await coordinator.read('records', async () => {
    loads += 1
    return { value: 3 }
  }), { value: 3 })
  assert.equal(loads, 3)

  let staleResolve: ((value: { value: string }) => void) | undefined
  const staleRead = coordinator.read('stale', () =>
    new Promise(resolve => { staleResolve = resolve }))
  await coordinator.mutate(async () => undefined)
  const freshRead = await coordinator.read('stale', async () => ({ value: 'fresh' }),
    { fresh: true })
  assert.deepEqual(freshRead, { value: 'fresh' })

  let resolveBeforeMutation: ((value: { value: string }) => void) | undefined
  const beforeMutation = coordinator.read('generation', () =>
    new Promise(resolve => { resolveBeforeMutation = resolve }))
  await Promise.resolve()
  await coordinator.mutate(async () => undefined)
  const afterMutation = coordinator.read('generation', async () => ({ value: 'new' }))
  resolveBeforeMutation?.({ value: 'old' })
  assert.deepEqual(await beforeMutation, { value: 'old' })
  assert.deepEqual(await afterMutation, { value: 'new' },
    'a read after mutation must not join an older in-flight request')
  staleResolve?.({ value: 'stale' })
  assert.deepEqual(await staleRead, { value: 'stale' })
  assert.deepEqual(await coordinator.read('stale', async () => ({ value: 'after' })),
    { value: 'after' })

  let failedLoads = 0
  await assert.rejects(() => coordinator.read('failed-load', async () => {
    failedLoads += 1
    throw new Error('read failed')
  }), /read failed/)
  assert.deepEqual(await coordinator.read('failed-load', async () => {
    failedLoads += 1
    return { recovered: true }
  }), { recovered: true })
  assert.equal(failedLoads, 2)

  const paged = createMockRequester([
    { list: [{ Id: 1 }], pageInfo: { isLastPage: false } },
    { list: [{ Id: 2 }], pageInfo: { isLastPage: true } }
  ])
  const client = createNocoClient({ requester: paged.requester, retryDelaysMs: [0] })
  const records = await client.fetchRecords('table', 1)
  assert.deepEqual(records.map((record: any) => record.Id), [1, 2])
  assert.equal(paged.calls.length, 2)
  assert.deepEqual(await createNocoClient({ requester: async () =>
    ({ data: [{ Id: 3 }] }), retryDelaysMs: [0] }).fetchRecords('table', 100), [{ Id: 3 }])
  await assert.rejects(() => createNocoClient({ requester: async () =>
    ({ data: {} }), retryDelaysMs: [0] }).fetchRecords('table', 100),
  (error: any) => error.code === 'noco_response_invalid')

  const limited = createMockRequester([
    Object.assign(httpError(429, 'Too Many Requests'), {
      response: { status: 429, headers: { 'retry-after': '0.025' }, data: { message: 'Too Many Requests' } }
    }),
    { ok: true }
  ])
  const retryLimiter = createNocoRequestLimiter({ log() {} })
  const retrying = createNocoClient({
    requester: limited.requester, retryDelaysMs: [0, 0], limiter: retryLimiter
  })
  const retryStarted = Date.now()
  assert.deepEqual(await retrying.request('get', '/test'), { ok: true })
  assert.ok(Date.now() - retryStarted >= 20)

  const transportRetry = createMockRequester([timeout, { ok: true }])
  assert.deepEqual(await createNocoClient({
    requester: transportRetry.requester,
    retryDelaysMs: [0, 0]
  }).request('get', '/transport'), { ok: true })
  assert.equal(transportRetry.calls.length, 2)

  const physicalAttempts: any[] = []
  const physicalRetry = createMockRequester([httpError(503, 'Unavailable'), { ok: true }])
  assert.deepEqual(await createNocoClient({
    requester: physicalRetry.requester,
    retryDelaysMs: [0, 0],
    onPhysicalAttempt: (attempt: any) => physicalAttempts.push(attempt)
  }).request('get', '/physical-attempt'), { ok: true })
  assert.deepEqual(physicalAttempts.map(attempt => attempt.attempt), [1, 2])
  assert.equal(physicalAttempts.every(attempt => attempt.method === 'get' &&
    attempt.endpoint === '/physical-attempt'), true)

  const createBodies: unknown[] = []
  let createCalls = 0
  const createStrategyClient = createNocoClient({ requester: async (request: any) => {
    createCalls += 1; createBodies.push(request.data)
    if (createCalls === 1 || createCalls === 4) throw httpError(422, 'Unsupported payload')
    return { data: { Id: createCalls } }
  }, retryDelaysMs: [0] })
  await createStrategyClient.createRecord('strategy-table', { value: 1 })
  await createStrategyClient.createRecord('strategy-table', { value: 2 })
  await createStrategyClient.createRecord('strategy-table', { value: 3 })
  await createStrategyClient.createRecord('strategy-table', { value: 4 })
  assert.deepEqual(createBodies.map(Array.isArray), [false, true, true, true, false, false])

  const patchBodies: unknown[] = []
  let patchCalls = 0
  const patchStrategyClient = createNocoClient({ requester: async (request: any) => {
    patchCalls += 1; patchBodies.push(request.data)
    if (patchCalls === 1 || patchCalls === 4) throw httpError(422, 'Unsupported payload')
    return { data: { ok: true } }
  }, retryDelaysMs: [0] })
  await patchStrategyClient.patchRecord('strategy-table', 1, { value: 1 })
  await patchStrategyClient.patchRecord('strategy-table', 1, { value: 2 })
  await patchStrategyClient.patchRecord('strategy-table', 1, { value: 3 })
  await patchStrategyClient.patchRecord('strategy-table', 1, { value: 4 })
  assert.deepEqual(patchBodies.map(Array.isArray), [false, true, true, true, false, false])

  const postNoRetry = createMockRequester([timeout, { Id: 8 }])
  await assert.rejects(() => createNocoClient({
    requester: postNoRetry.requester,
    retryDelaysMs: [0, 0]
  }).createRecord('table', { status: 'new' }),
  (error: any) => error.code === 'noco_timeout')
  assert.equal(postNoRetry.calls.length, 1)

  const declinedRetry = createMockRequester([httpError(503, 'Unavailable'), { ok: true }])
  let policyCalls = 0
  await assert.rejects(() => createNocoClient({
    requester: declinedRetry.requester,
    retryDelaysMs: [0, 0],
    retryPolicy: () => {
      policyCalls += 1
      return { retry: false }
    }
  }).request('get', '/declined'), (error: any) => error.code === 'noco_service_unavailable')
  assert.equal(policyCalls, 1)
  assert.equal(declinedRetry.calls.length, 1)

  let cachedCalls = 0
  const cachedClient = createNocoClient({
    requester: async () => ({ data: { call: ++cachedCalls } }),
    readCacheTtlMs: 15_000,
    retryDelaysMs: [0]
  })
  const [cachedOne, cachedJoined] = await Promise.all([
    cachedClient.request('get', '/cached'),
    cachedClient.request('get', '/cached')
  ])
  assert.deepEqual(cachedOne, { call: 1 })
  assert.deepEqual(cachedJoined, { call: 1 })
  assert.equal(cachedCalls, 1)
  assert.deepEqual(await cachedClient.request('get', '/cached', undefined, { fresh: true }),
    { call: 2 })
  assert.equal(cachedCalls, 2)

  let sharedNow = 0
  const sharedStarts: number[] = []
  const sharedLimiter = createNocoRequestLimiter({
    maxRequestsPerBatch: 4,
    batchPauseMs: 100,
    now: () => sharedNow,
    sleep: async (milliseconds: number) => { sharedNow += milliseconds },
    log() {}
  })
  const sharedRequester = async () => {
    sharedStarts.push(sharedNow)
    return { data: { ok: true } }
  }
  const firstClient = createNocoClient({
    requester: sharedRequester,
    limiter: sharedLimiter,
    retryDelaysMs: [0]
  })
  const secondClient = createNocoClient({
    requester: sharedRequester,
    limiter: sharedLimiter,
    retryDelaysMs: [0]
  })
  await Promise.all([
    firstClient.request('get', '/shared/1'),
    secondClient.request('get', '/shared/2'),
    firstClient.request('get', '/shared/3'),
    secondClient.request('get', '/shared/4'),
    firstClient.request('get', '/shared/5')
  ])
  assert.equal(sharedStarts.length, 5)
  assert.ok(sharedStarts[4] - sharedStarts[3] >= 100,
    'clients sharing one limiter must share the completed-request batch')

  assert.deepEqual(uniqueRelatedIds([1, 1, 2, 0]), [1, 2])
  assert.deepEqual(buildLinkPayloads([1, 1, 2]), [
    [{ Id: 1 }, { Id: 2 }],
    { data: [{ Id: 1 }, { Id: 2 }] }
  ])
  assert.equal(getLinkedRecord({ Id: 5, name: 'one' })?.Id, 5)
  assert.equal(getLinkedRecord([{ Id: 6 }, { Id: 7 }])?.Id, 6)
  assert.equal(getLinkedRecord({ data: [{ Id: 8 }] })?.Id, 8)
  assert.deepEqual(getLinkedRecords(null), [])
  assert.equal(getLinkedRecordId([{ Id: 9 }]), 9)
  assert.equal(formatLinkedRecordLabel({ Id: 10, client_name: 'Кира' }), '10 Кира')
  assert.equal(formatLinkedRecordLabel({ Id: 11, company_name: 'Acme' }), '11 Acme')
  assert.equal(formatLinkedRecordLabel({ Id: 12 }), '12')
  assert.equal(formatLinkedRelationLabel([{ Id: 13, name: 'Frontend' }, { Id: 14, name: 'Python' }]), '13 Frontend, 14 Python')
  assert.equal(formatLinkedRelationLabel(null), '')

  const previousNoRef = process.env.NOCO_NO_MIGRATION_REFS
  process.env.NOCO_NO_MIGRATION_REFS = 'true'
  assert.equal(noMigrationRefsEnabled(), true)
  if (previousNoRef === undefined) {
    delete process.env.NOCO_NO_MIGRATION_REFS
  } else {
    process.env.NOCO_NO_MIGRATION_REFS = previousNoRef
  }

  assert.equal(normalizeLookupText(' Ёж  Тест '), 'еж тест')
  assert.equal(slugify('Сбер ГигаЧат'), 'sber_gigachat')
  const used = new Set(['item'])
  assert.equal(uniqueValue('item', used), 'item_2')

  const dir = createTempDir()
  writeJson(dir, 'data.json', { ok: true })
  writeText(dir, 'data.txt', 'hello')
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).ok, true)
  assert.equal(fs.readFileSync(path.join(dir, 'data.txt'), 'utf8'), 'hello')
}

Promise.resolve()
  .then(runTests)
  .then(() => {
    console.log('noco:core tests passed')
  })
  .catch((error: any) => {
    console.error(error)
    process.exitCode = 1
  })
