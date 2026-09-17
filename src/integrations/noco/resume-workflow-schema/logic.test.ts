const assert = require('node:assert/strict')
const {
  ensureResumeWorkflowSchema,
  inspectColumns,
  READY_FOR_INTERVIEW_IN_ENGLISH_IN_2_MONTHS_OPTIONS,
  RESUME_CLIENT_COLUMNS
} = require('./logic.ts') as {
  ensureResumeWorkflowSchema(client: any, tableIds: { clients: string; cvProcessing: string; platforms: string }, apply: boolean): Promise<any>
  inspectColumns(meta: any, expectedColumns: any[]): any
  READY_FOR_INTERVIEW_IN_ENGLISH_IN_2_MONTHS_OPTIONS: ReadonlyArray<{ title: string; color: string }>
  RESUME_CLIENT_COLUMNS: ReadonlyArray<{ title: string; uidt: string; colOptions?: any }>
}

async function run() {
  const columns: Record<string, Array<{ title: string; uidt: string; colOptions?: any }>> = {
    clients: [],
    cv: [],
    platforms: []
  }
  const platforms: Array<Record<string, unknown>> = []
  const calls: Array<{ method: string; endpoint?: string; tableId?: string; body: any }> = []
  const client = {
    async fetchTableMeta(tableId: string) {
      return { columns: columns[tableId] ?? [] }
    },
    async fetchRecords(tableId: string) {
      assert.equal(tableId, 'platforms')
      return platforms
    },
    async createRecord(tableId: string, body: any) {
      calls.push({ method: 'createRecord', tableId, body })
      platforms.push({ Id: platforms.length + 1, ...body })
    },
    async request(method: string, endpoint: string, body: any) {
      calls.push({ method, endpoint, body })
      const tableId = endpoint.includes('/clients/') ? 'clients' : endpoint.includes('/cv/') ? 'cv' : ''
      columns[tableId].push({ title: body.title, uidt: body.uidt, colOptions: body.colOptions })
    }
  }

  const dry = await ensureResumeWorkflowSchema(client, { clients: 'clients', cvProcessing: 'cv', platforms: 'platforms' }, false)
  assert.equal(dry.ok, false)
  assert.deepEqual(calls, [])

  const applied = await ensureResumeWorkflowSchema(client, { clients: 'clients', cvProcessing: 'cv', platforms: 'platforms' }, true)
  assert.equal(applied.ok, true)
  assert.deepEqual(applied.created.platforms, ['github'])
  assert(columns.clients.some(column => column.title === 'education_entries'))
  const interviewColumn = columns.clients.find(
    column => column.title === 'ready_for_interview_in_english_in_2_months'
  )
  assert.equal(interviewColumn?.uidt, 'SingleSelect')
  assert.deepEqual(
    interviewColumn?.colOptions?.options,
    READY_FOR_INTERVIEW_IN_ENGLISH_IN_2_MONTHS_OPTIONS
  )
  assert(columns.cv.some(column => column.title === 'last_rejection_comment'))
  assert(platforms.some(platform => platform.label === 'github'))

  const expectedInterviewColumn = RESUME_CLIENT_COLUMNS.find(
    column => column.title === 'ready_for_interview_in_english_in_2_months'
  )
  assert(expectedInterviewColumn)
  const incompatible = inspectColumns({
    columns: [{
      title: 'ready_for_interview_in_english_in_2_months',
      uidt: 'SingleSelect',
      colOptions: { options: [{ title: 'Yes' }, { title: 'Maybe' }] }
    }]
  }, [expectedInterviewColumn])
  assert.equal(incompatible.ok, false)
  assert.deepEqual(incompatible.missing, [])
  assert.deepEqual(incompatible.incompatible, ['ready_for_interview_in_english_in_2_months'])
}

run()
  .then(() => console.log('resume workflow Noco schema tests passed'))
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
