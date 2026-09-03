const assert = require('node:assert/strict')
const { createNocoClient } = require('../../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { CONNECTION_SEARCH_CATALOG } = require('../catalog.ts') as typeof import('../catalog.ts')
const { createConnectionInviterService } = require('../service.ts') as typeof import('../service.ts')
const { createConnectionNocoBudgetController } = require('../noco-budget.ts') as
  typeof import('../noco-budget.ts')
const { fixture, waitRun } = require('./fixtures.ts') as typeof import('./fixtures.ts')

type PhysicalRequest = {
  method: 'get' | 'post' | 'patch' | 'delete'
  url: string
  data?: unknown
}

type FakeNocoState = {
  calls: PhysicalRequest[]
  faults: {
    catalogReadRetry: number
    runCreateFallback: number
    runPatchFallback: number
    historyPatchRetry: number
  }
  requester(request: PhysicalRequest): Promise<{ data: unknown }>
}

const TABLE_IDS = { catalog: 'catalog', runs: 'runs', history: 'history' } as const

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), {
    response: { status, data: { message }, headers: {} }
  })
}

function decodedEqualityValues(where: string, field: string): string[] {
  const values: string[] = []
  const pattern = new RegExp(`\\(${field},eq,([^()]*)\\)`, 'g')
  for (const match of where.matchAll(pattern)) {
    values.push(match[1].replace(/\\([\\(),])/g, '$1'))
  }
  return values
}

function matchesWhere(row: Record<string, unknown>, where: string): boolean {
  if (!where) return true
  for (const field of ['run_key', 'run_id', 'platform_account_id', 'history_key', 'status']) {
    const values = decodedEqualityValues(where, field)
    if (values.length && !values.includes(String(row[field] ?? ''))) return false
  }
  return true
}

function payloadRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data as Array<Record<string, unknown>>
  return data && typeof data === 'object' ? [data as Record<string, unknown>] : []
}

async function createPhysicalNoco(): Promise<FakeNocoState> {
  const { CONNECTION_TABLES } = await import(
    '../../../../integrations/noco/linkedin-connection-inviter-schema/logic.ts')
  const definitions: Record<string, any> = {
    [TABLE_IDS.catalog]: CONNECTION_TABLES.catalog,
    [TABLE_IDS.runs]: CONNECTION_TABLES.runs,
    [TABLE_IDS.history]: CONNECTION_TABLES.history
  }
  const tables = Object.entries(TABLE_IDS).map(([key, id]) => ({
    id,
    title: (CONNECTION_TABLES as any)[key].title
  }))
  const rows: Record<string, Array<Record<string, unknown>>> = {
    [TABLE_IDS.catalog]: CONNECTION_SEARCH_CATALOG.map((template, index) => ({
      Id: index + 1,
      source_key: template.sourceKey,
      audience: template.audience,
      city: template.city,
      keyword_template: template.keywordTemplate,
      priority: template.priority,
      enabled: template.enabled
    })),
    [TABLE_IDS.runs]: [],
    [TABLE_IDS.history]: []
  }
  let nextId = CONNECTION_SEARCH_CATALOG.length + 1
  const calls: PhysicalRequest[] = []
  const faults = {
    catalogReadRetry: 0,
    runCreateFallback: 0,
    runPatchFallback: 0,
    historyPatchRetry: 0
  }

  async function requester(request: PhysicalRequest): Promise<{ data: unknown }> {
    calls.push(structuredClone(request))
    const parsed = new URL(request.url)
    const path = parsed.pathname
    const method = request.method.toLowerCase()

    if (method === 'get' && path.endsWith('/meta/bases/budget-base/tables')) {
      return { data: { list: tables } }
    }
    const meta = path.match(/\/api\/v2\/meta\/tables\/([^/]+)$/)
    if (method === 'get' && meta) {
      return { data: { columns: definitions[meta[1]]?.columns ?? [] } }
    }

    const records = path.match(/\/api\/v2\/tables\/([^/]+)\/records(?:\/(\d+))?$/)
    if (!records) throw new Error(`Unexpected fake Noco request: ${method} ${path}`)
    const tableId = records[1]
    if (!rows[tableId]) throw new Error(`Unknown fake Noco table: ${tableId}`)

    if (method === 'get') {
      if (tableId === TABLE_IDS.catalog && faults.catalogReadRetry === 0) {
        faults.catalogReadRetry += 1
        throw httpError(503, 'Injected catalog read retry')
      }
      const limit = Math.max(1, Number(parsed.searchParams.get('limit')) || 100)
      const offset = Math.max(0, Number(parsed.searchParams.get('offset')) || 0)
      const where = parsed.searchParams.get('where') ?? ''
      const filtered = rows[tableId].filter(row => matchesWhere(row, where))
      const page = filtered.slice(offset, offset + limit).map(row => structuredClone(row))
      return { data: { list: page,
        pageInfo: { isLastPage: offset + limit >= filtered.length } } }
    }

    if (method === 'post') {
      if (tableId === TABLE_IDS.runs && !Array.isArray(request.data) &&
        faults.runCreateFallback === 0) {
        faults.runCreateFallback += 1
        throw httpError(422, 'Injected object-to-array create fallback')
      }
      const created = payloadRows(request.data).map(value => {
        const uniqueField = tableId === TABLE_IDS.runs ? 'run_key' :
          tableId === TABLE_IDS.history ? 'history_key' : undefined
        if (uniqueField && rows[tableId].some(row => row[uniqueField] === value[uniqueField])) {
          throw httpError(422, `Duplicate ${uniqueField}`)
        }
        const row = { ...structuredClone(value), Id: nextId++ }
        rows[tableId].push(row)
        return structuredClone(row)
      })
      return { data: Array.isArray(request.data) ? created : created[0] }
    }

    if (method === 'patch') {
      if (tableId === TABLE_IDS.runs && !Array.isArray(request.data) && !records[2] &&
        faults.runPatchFallback === 0) {
        faults.runPatchFallback += 1
        throw httpError(422, 'Injected object-to-array patch fallback')
      }
      if (tableId === TABLE_IDS.history && faults.historyPatchRetry === 0) {
        faults.historyPatchRetry += 1
        throw httpError(503, 'Injected idempotent history patch retry')
      }
      const patches = payloadRows(request.data).map(value => ({
        ...value,
        ...(records[2] && !value.Id ? { Id: Number(records[2]) } : {})
      }))
      for (const patch of patches) {
        const index = rows[tableId].findIndex(row => Number(row.Id) === Number(patch.Id))
        if (index < 0) throw httpError(404, 'Fake Noco row not found')
        rows[tableId][index] = { ...rows[tableId][index], ...structuredClone(patch) }
      }
      return { data: Array.isArray(request.data) ? patches : patches[0] }
    }

    throw new Error(`Unsupported fake Noco request: ${method} ${path}`)
  }

  return { calls, faults, requester }
}

function requestTable(call: PhysicalRequest): string | undefined {
  return new URL(call.url).pathname.match(/\/api\/v2\/tables\/([^/]+)\/records/)?.[1]
}

function firstPayloadRow(call: PhysicalRequest): Record<string, unknown> {
  return payloadRows(call.data)[0] ?? {}
}

function restoreEnvironment(previous: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

async function runPhysicalNocoBudgetRegression() {
  const environmentNames = ['NOCODB_API_TOKEN', 'NOCODB_BASE_URL', 'NOCODB_BASE_ID']
  const previous = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]))
  process.env.NOCODB_API_TOKEN = 'physical-budget-test-token'
  process.env.NOCODB_BASE_URL = 'https://noco-budget.invalid'
  process.env.NOCODB_BASE_ID = 'budget-base'

  try {
    const fake = await createPhysicalNoco()
    const budget = createConnectionNocoBudgetController()
    const client = createNocoClient({ requester: fake.requester, pageDelayMs: 0,
      readCacheTtlMs: 0, retryDelaysMs: [0, 0, 0], maxAutomaticRetries: 2,
      onPhysicalAttempt: budget.onPhysicalAttempt })
    const { createConnectionInviterStore } = await import('../noco-store.mts')
    const store = createConnectionInviterStore(client, { budgetController: budget })
    const base = fixture({ stack: 'GO', connectionCount: 1663, preflightRejectCount: 4 })
    const productiveSearch = base.adapter.searchPeople.bind(base.adapter)
    let emptySearchPages = 0
    let totalSearchPages = 0
    base.adapter.searchPeople = async (...args: any[]) => {
      totalSearchPages += 1
      if (emptySearchPages < 18) {
        emptySearchPages += 1
        return { items: [] }
      }
      return productiveSearch(...args)
    }
    let clock = new Date('2026-08-24T09:00:00Z').getTime()
    const service = createConnectionInviterService({
      ...base,
      store,
      autoRecover: false,
      now: () => new Date(clock),
      random: () => 0,
      sleep: async (milliseconds: number) => { clock += milliseconds },
      gate: { acquire() { return () => undefined } },
      logger: { event() {} }
    })

    const started: any = await service.start(7)
    const completed: any = await waitRun(service, started.runId)
    const executionPhysicalRequests = fake.calls.length
    const history: any[] = await service.history(7)
    console.log('connection sparse terminal snapshot', {
      status: completed.status,
      stage: completed.stage,
      sent: completed.counters.sent,
      budget: store.nocoBudgetSnapshot(started.runId),
      physical: fake.calls.length
    })

    assert.equal(completed.status, 'succeeded')
    assert.equal(completed.stage, 'completed')
    assert.equal(completed.counters.sent, 40)
    assert.deepEqual(completed.counters.sentByAudience, { recruiter: 28, technical: 12 })
    assert.equal(base.metrics.sends, 40)
    assert.equal(history.filter(item => item.status === 'sent').length, 40)
    assert.equal(emptySearchPages, 18)
    assert.equal(totalSearchPages >= 18, true)

    const totalPhysicalRequests = fake.calls.length
    const budgetSnapshot = store.nocoBudgetSnapshot(started.runId)
    const catalogGets = fake.calls.filter(call => call.method === 'get' &&
      requestTable(call) === TABLE_IDS.catalog)
    const runPatches = fake.calls.filter(call => call.method === 'patch' &&
      requestTable(call) === TABLE_IDS.runs)
    const physicalByMethod = fake.calls.reduce((counts, call) => {
      counts[call.method] = (counts[call.method] ?? 0) + 1
      return counts
    }, {} as Record<string, number>)
    const physicalByTableAndMethod = fake.calls.reduce((counts, call) => {
      const table = requestTable(call) ?? (new URL(call.url).pathname.includes('/meta/')
        ? 'meta' : 'other')
      const key = `${call.method}:${table}`
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {} as Record<string, number>)
    const runPatchesByStage = runPatches.reduce((counts, call) => {
      const stage = String(firstPayloadRow(call).stage ?? 'unknown')
      counts[stage] = (counts[stage] ?? 0) + 1
      return counts
    }, {} as Record<string, number>)
    const breakdown = {
      totalPhysicalRequests,
      physicalByMethod,
      physicalByTableAndMethod,
      runPatches: runPatches.length,
      runPatchesByStage,
      emptySearchPages,
      totalSearchPages,
      invitations: base.metrics.sends,
      budgetSnapshot,
      faults: fake.faults
    }
    console.log('connection sparse physical Noco budget observed', breakdown)

    assert.equal(totalPhysicalRequests <= 220, true,
      `Physical Noco budget exceeded: ${JSON.stringify(breakdown)}`)
    assert.equal(budgetSnapshot.physicalAttempts, executionPhysicalRequests - 1,
      'Only the terminal waitRun read may be outside the attributed execution budget.')
    assert.deepEqual(fake.faults, {
      catalogReadRetry: 1,
      runCreateFallback: 1,
      runPatchFallback: 1,
      historyPatchRetry: 1
    })

    assert.equal(catalogGets.length, 5,
      'Four catalog pages plus one physical retry must be counted.')
    assert.deepEqual(catalogGets.map(call =>
      Number(new URL(call.url).searchParams.get('offset'))), [0, 0, 100, 200, 300])
    assert.equal(runPatches.every(call => {
      const body = firstPayloadRow(call)
      return 'counters_json' in body && 'search_progress_json' in body &&
        Object.keys(body).length > 10
    }), true, 'A heartbeat-only run PATCH was emitted.')
    console.log('connection sparse physical Noco budget regression passed')
  } finally {
    restoreEnvironment(previous)
  }
}

module.exports = { runPhysicalNocoBudgetRegression }
