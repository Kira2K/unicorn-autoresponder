const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')
require('dotenv').config({ quiet: true })

type NocoRecord = Record<string, unknown> & { Id: number }
type MentorRole = 'soft' | 'hard'

type MentorPlan = {
  name: string
  sourceNames: string[]
  roles: MentorRole[]
  stackNames: string[]
  clientIds: number[]
}

type TableConfig = {
  key: string
  id: string
  title: string
}

const MENTOR_CLIENT_IDENTITY_OVERRIDES: Record<string, { fio: string }> = {
  'алексей|сериков алексей валерьевич': { fio: 'сериков алексей валерьевич' },
  'дан|цой дан александрович': { fio: 'цой дан александрович' },
  'вова vue|рыбалкин владимир александрович': { fio: 'рыбалкин владимир александрович' },
  'никита|шаталов никита константинович': { fio: 'шаталов никита константинович' },
  'андрей кочеткова|кочетков андрей андреевич': { fio: 'кочетков андрей андреевич' }
}

const BASE_URL = (
  process.env.NOCODB_BASE_URL ||
  process.env.nocodb_base_url ||
  'https://app.nocodb.com'
).replace(/\/+$/, '')
const TOKEN = process.env.nocodb_api_token || process.env.NOCODB_API_TOKEN
const BASE_ID = process.env.NOCODB_BASE_ID || 'pqe5susktrsa9z3'

const TABLES = {
  clients: {
    key: 'clients',
    id: 'mxza381054ldlza',
    title: 'clients'
  },
  stacks: {
    key: 'stacks',
    id: 'msr3ihfj0kjue1t',
    title: 'stacks'
  }
}

function assertConfig(): void {
  if (!TOKEN) {
    throw new Error('Missing nocodb_api_token in environment')
  }
}

function headers(): Record<string, string> {
  return {
    'xc-token': TOKEN as string,
    'Content-Type': 'application/json'
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function describeError(error: any): string {
  const data = error?.response?.data
  const message =
    data?.message ??
    data?.msg ??
    data?.error ??
    error?.message ??
    error ??
    'Unknown error'

  if (typeof message === 'string') {
    return message
  }

  try {
    return JSON.stringify(message)
  } catch {
    return String(message)
  }
}

async function nocoRequest<T>(
  method: 'get' | 'post' | 'patch',
  endpoint: string,
  body?: unknown
): Promise<T> {
  const delays = [0, 2500, 5000, 10000, 20000]
  let lastError: any

  for (const delay of delays) {
    if (delay) {
      await wait(delay)
    }

    try {
      const response = await axios.request({
        method,
        url: `${BASE_URL}${endpoint}`,
        data: body,
        headers: headers(),
        timeout: 60000
      })
      return response.data
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      const message = describeError(error)
      if (status !== 429 && !String(message).includes('Too Many Requests')) {
        throw error
      }
    }
  }

  throw lastError ?? new Error(`NocoDB request failed: ${method.toUpperCase()} ${endpoint}`)
}

async function fetchTables(): Promise<any[]> {
  const data = await nocoRequest<{ list?: any[] }>(
    'get',
    `/api/v2/meta/bases/${BASE_ID}/tables`
  )
  return data.list ?? []
}

async function fetchTableMeta(tableId: string): Promise<any> {
  return nocoRequest('get', `/api/v2/meta/tables/${tableId}`)
}

async function fetchRecords(tableId: string): Promise<NocoRecord[]> {
  const records: NocoRecord[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const data = await nocoRequest<{ list?: NocoRecord[]; pageInfo?: { isLastPage?: boolean } }>(
      'get',
      `/api/v2/tables/${tableId}/records?limit=${limit}&offset=${offset}`
    )
    const list = data.list ?? []
    records.push(...list)

    if (data.pageInfo?.isLastPage || list.length < limit) {
      break
    }

    offset += limit
  }

  return records
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function normalizeId(value: unknown): string {
  return String(value ?? '').trim().replace(/\.0$/, '')
}

function normalizeStackName(value: unknown): string {
  const normalized = normalizeText(value)
  if (normalized === 'c#') {
    return 'csharp'
  }
  if (normalized === 'fullstack') {
    return 'fullstack'
  }
  if (normalized === 'aqa (python)' || normalized === 'aqa python') {
    return 'aqa_python'
  }
  return normalized.replace(/[^a-zа-я0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function isStatusLikeStack(value: unknown): boolean {
  return ['чс', 'ушли', 'выпуск'].includes(normalizeText(value))
}

function mentorDisplayName(value: unknown): string {
  const raw = String(value ?? '').trim()
  const normalized = normalizeText(raw)

  if (!raw || normalized === 'хард-ментор' || normalized === 'софт-ментор') {
    return ''
  }

  if (normalized === '@lizhenginger') {
    return 'Лиза'
  }

  return raw
}

function findCell(values: string[][], expected: string): { row: number; column: number } | null {
  const expectedNormalized = normalizeText(expected)
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column < (values[row] ?? []).length; column += 1) {
      if (normalizeText(values[row][column]) === expectedNormalized) {
        return { row, column }
      }
    }
  }

  return null
}

async function loadMentorPlansFromSheet(clients: NocoRecord[]): Promise<{
  plans: MentorPlan[]
  unmatchedClients: unknown[]
}> {
  const {
    fetchSheetValues,
    getRequiredSheet
  } = require('../integrations/google-sheets.ts') as {
    fetchSheetValues(sheetNames: string[]): Promise<{
      sheets: Array<{ title: string; values: string[][] }>
    }>
    getRequiredSheet(
      sheets: Array<{ title: string; values: string[][] }>,
      expectedTitle: string
    ): string[][]
  }
  const sheetState = await fetchSheetValues(['ПЕРС ДАННЫЕ'])
  const values = getRequiredSheet(sheetState.sheets, 'ПЕРС ДАННЫЕ')
  const stackCell = findCell(values, 'стек')
  const nameCell = findCell(values, 'имя')
  const chatCell = findCell(values, 'Id общего чата')
  const hardCell = findCell(values, 'хард-ментор')
  const softCell = findCell(values, 'софт-ментор')

  if (!stackCell || !nameCell || !hardCell || !softCell) {
    throw new Error('Could not find stack/name/hard mentor/soft mentor rows in ПЕРС ДАННЫЕ.')
  }

  const clientByName = new Map<string, NocoRecord[]>()
  const clientByChatId = new Map<string, NocoRecord[]>()
  const clientByFio = new Map<string, NocoRecord[]>()
  for (const client of clients) {
    const nameKey = normalizeText(client.client_name)
    if (nameKey) {
      clientByName.set(nameKey, [...(clientByName.get(nameKey) ?? []), client])
    }

    const fioKey = normalizeText(client.fio)
    if (fioKey) {
      clientByFio.set(fioKey, [...(clientByFio.get(fioKey) ?? []), client])
    }

    const chatId = normalizeId(client.telegram_general_chat_id)
    if (chatId) {
      clientByChatId.set(chatId, [...(clientByChatId.get(chatId) ?? []), client])
    }
  }

  const plansByName = new Map<string, MentorPlan>()
  const unmatchedClients: unknown[] = []
  const maxColumn = Math.max(
    values[stackCell.row]?.length ?? 0,
    values[nameCell.row]?.length ?? 0,
    values[hardCell.row]?.length ?? 0,
    values[softCell.row]?.length ?? 0
  )

  function addMentor(input: {
    mentorName: string
    sourceName: string
    role: MentorRole
    stackName: string
    clientId: number
  }): void {
    const existing =
      plansByName.get(input.mentorName) ??
      ({
        name: input.mentorName,
        sourceNames: [],
        roles: [],
        stackNames: [],
        clientIds: []
      } as MentorPlan)

    if (!existing.sourceNames.includes(input.sourceName)) {
      existing.sourceNames.push(input.sourceName)
    }
    if (!existing.roles.includes(input.role)) {
      existing.roles.push(input.role)
    }
    if (
      input.stackName &&
      !isStatusLikeStack(input.stackName) &&
      !existing.stackNames.includes(input.stackName)
    ) {
      existing.stackNames.push(input.stackName)
    }
    if (!existing.clientIds.includes(input.clientId)) {
      existing.clientIds.push(input.clientId)
    }

    plansByName.set(input.mentorName, existing)
  }

  for (let column = nameCell.column + 1; column < maxColumn; column += 1) {
    const sheetClientName = String(values[nameCell.row]?.[column] ?? '').trim()
    const hardMentor = mentorDisplayName(values[hardCell.row]?.[column])
    const softMentor = mentorDisplayName(values[softCell.row]?.[column])
    const sheetStackName = String(values[stackCell.row]?.[column] ?? '').trim()
    const sheetChatId = chatCell ? normalizeId(values[chatCell.row]?.[column]) : ''
    const sheetFio = String(values[findCell(values, 'ФИО')?.row ?? -1]?.[column] ?? '').trim()

    if (!sheetClientName || (!hardMentor && !softMentor)) {
      continue
    }

    const chatMatches = sheetChatId ? clientByChatId.get(sheetChatId) ?? [] : []
    const nameMatches = clientByName.get(normalizeText(sheetClientName)) ?? []
    const override =
      MENTOR_CLIENT_IDENTITY_OVERRIDES[`${normalizeText(sheetClientName)}|${normalizeText(sheetFio)}`]
    const overrideMatches = override ? clientByFio.get(normalizeText(override.fio)) ?? [] : []
    const matches = overrideMatches.length === 1
      ? overrideMatches
      : chatMatches.length === 1
        ? chatMatches
        : nameMatches
    if (matches.length !== 1) {
      unmatchedClients.push({
        sheetClientName,
        sheetStackName,
        sheetChatId,
        sheetFio,
        hardMentor,
        softMentor,
        matchCount: matches.length,
        chatMatchCount: chatMatches.length,
        nameMatchCount: nameMatches.length
      })
      continue
    }

    const client = matches[0]
    const clientId = Number(client.Id)

    if (hardMentor) {
      addMentor({
        mentorName: hardMentor,
        sourceName: String(values[hardCell.row]?.[column] ?? '').trim(),
        role: 'hard',
        stackName: sheetStackName,
        clientId
      })
    }

    if (softMentor) {
      addMentor({
        mentorName: softMentor,
        sourceName: String(values[softCell.row]?.[column] ?? '').trim(),
        role: 'soft',
        stackName: 'soft-skills',
        clientId
      })
    }
  }

  return {
    plans: [...plansByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unmatchedClients
  }
}

function stackKeyForName(name: string): string {
  return normalizeStackName(name)
}

function stackDisplayKeys(stack: NocoRecord): string[] {
  return [
    stack.name,
    stack.stack,
    stack.stack_name,
    stack.title
  ]
    .map(normalizeStackName)
    .filter(Boolean)
}

function findStackByName(stacks: NocoRecord[], name: string): NocoRecord | undefined {
  const key = stackKeyForName(name)
  return stacks.find(stack => stackDisplayKeys(stack).includes(key))
}

async function createRecord(tableId: string, record: Record<string, unknown>): Promise<void> {
  const attempts = [
    { endpoint: `/api/v2/tables/${tableId}/records`, body: record },
    { endpoint: `/api/v2/tables/${tableId}/records`, body: [record] }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('post', attempt.endpoint, attempt.body)
      return
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
): Promise<void> {
  const payload = { Id: recordId, ...patch }
  const attempts = [
    { endpoint: `/api/v2/tables/${tableId}/records`, body: payload },
    { endpoint: `/api/v2/tables/${tableId}/records`, body: [payload] },
    { endpoint: `/api/v2/tables/${tableId}/records/${recordId}`, body: patch }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('patch', attempt.endpoint, attempt.body)
      return
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

async function renameColumn(columnId: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const attempts = [
    { endpoint: `/api/v2/meta/columns/${columnId}`, body: { title, column_name: title } },
    { endpoint: `/api/v1/db/meta/columns/${columnId}`, body: { title, column_name: title } }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('patch', attempt.endpoint, attempt.body)
      return { ok: true }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return { ok: false, error: describeError(lastError) }
}

async function ensureSoftSkillsStack(): Promise<NocoRecord> {
  const stacks = await fetchRecords(TABLES.stacks.id)
  const existing = findStackByName(stacks, 'soft-skills')
  if (existing) {
    return existing
  }

  await createRecord(TABLES.stacks.id, {
    name: 'soft-skills'
  })
  const updatedStacks = await fetchRecords(TABLES.stacks.id)
  const created = findStackByName(updatedStacks, 'soft-skills')
  if (!created) {
    throw new Error('Failed to create soft-skills stack.')
  }
  return created
}

async function ensureMentorsTable(): Promise<TableConfig> {
  const existing = (await fetchTables()).find(
    table => String(table.title ?? table.table_name ?? '').toLowerCase() === 'mentors'
  )

  if (existing?.id) {
    return {
      key: 'mentors',
      id: existing.id,
      title: existing.title ?? 'mentors'
    }
  }

  const attempts = [
    {
      endpoint: `/api/v2/meta/bases/${BASE_ID}/tables`,
      body: {
        title: 'mentors',
        table_name: 'mentors',
        columns: [
          {
            title: 'Name',
            column_name: 'name',
            uidt: 'SingleLineText',
            pv: true
          },
          {
            title: 'Payment country',
            column_name: 'payment_country',
            uidt: 'SingleLineText'
          }
        ]
      }
    },
    {
      endpoint: `/api/v1/db/meta/projects/${BASE_ID}/tables`,
      body: {
        title: 'mentors',
        table_name: 'mentors',
        columns: [
          {
            title: 'Name',
            column_name: 'name',
            uidt: 'SingleLineText',
            pv: true
          },
          {
            title: 'Payment country',
            column_name: 'payment_country',
            uidt: 'SingleLineText'
          }
        ]
      }
    }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoRequest('post', attempt.endpoint, attempt.body)
      const created = (await fetchTables()).find(
        table => String(table.title ?? table.table_name ?? '').toLowerCase() === 'mentors'
      )
      if (created?.id) {
        return {
          key: 'mentors',
          id: created.id,
          title: created.title ?? 'mentors'
        }
      }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError ?? new Error('Failed to create mentors table.')
}

async function ensureMentorColumns(table: TableConfig): Promise<unknown[]> {
  const desiredColumns = [
    { title: 'Name', uidt: 'SingleLineText' },
    { title: 'Payment country', uidt: 'SingleLineText' }
  ]
  const results = []

  for (const column of desiredColumns) {
    const meta = await fetchTableMeta(table.id)
    const existing = (meta.columns ?? []).find((item: any) => item.title === column.title)
    if (existing) {
      results.push({ title: column.title, ok: true, existing: true, id: existing.id })
      continue
    }

    try {
      const created = await nocoRequest<any>('post', `/api/v2/meta/tables/${table.id}/columns`, {
        title: column.title,
        uidt: column.uidt
      })
      results.push({ title: column.title, ok: true, existing: false, id: created?.id })
    } catch (error: any) {
      results.push({
        title: column.title,
        ok: false,
        error: describeError(error)
      })
    }
  }

  return results
}

async function ensureRelationField(
  sourceTable: TableConfig,
  relatedTable: TableConfig,
  title: string
): Promise<{ ok: boolean; id?: string; existing: boolean; error?: string }> {
  const meta = await fetchTableMeta(sourceTable.id)
  const existing = (meta.columns ?? []).find((column: any) => column.title === title)
  if (existing?.id) {
    return { ok: true, id: existing.id, existing: true }
  }

  const existingByRelation = (meta.columns ?? [])
    .filter((column: any) => {
      const options = column.colOptions ?? {}
      return (
        !column.system &&
        (column.uidt === 'LinkToAnotherRecord' || column.uidt === 'Links') &&
        options.type === 'mm' &&
        options.fk_related_model_id === relatedTable.id
      )
    })
    .sort((a: any, b: any) => Number(a.order ?? 0) - Number(b.order ?? 0))[0]

  if (existingByRelation?.id) {
    const renameResult = await renameColumn(existingByRelation.id, title)
    return {
      ok: true,
      id: existingByRelation.id,
      existing: true,
      ...(renameResult.ok
        ? {}
        : { error: `Reused existing relation, but could not rename it: ${renameResult.error}` })
    }
  }

  const attempts = [
    {
      title,
      column_name: title,
      uidt: 'LinkToAnotherRecord',
      type: 'mm',
      childId: sourceTable.id,
      parentId: relatedTable.id
    },
    {
      title,
      column_name: title,
      uidt: 'Links',
      type: 'mm',
      childId: sourceTable.id,
      parentId: relatedTable.id
    }
  ]
  let lastError: any

  for (const body of attempts) {
    try {
      await nocoRequest('post', `/api/v2/meta/tables/${sourceTable.id}/columns`, body)
      const updatedMeta = await fetchTableMeta(sourceTable.id)
      const created = (updatedMeta.columns ?? []).find((column: any) => column.title === title)
      if (created?.id) {
        return { ok: true, id: created.id, existing: false }
      }
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  return {
    ok: false,
    existing: false,
    error: describeError(lastError)
  }
}

async function linkRecords(
  sourceTable: TableConfig,
  fieldId: string,
  sourceRecordId: number,
  relatedIds: number[]
): Promise<{ ok: boolean; linked?: number; error?: string }> {
  const uniqueIds = [...new Set(relatedIds)].filter(Boolean)
  if (!uniqueIds.length) {
    return { ok: true, linked: 0 }
  }

  const bodies = [
    uniqueIds.map(Id => ({ Id })),
    { data: uniqueIds.map(Id => ({ Id })) }
  ]

  for (const body of bodies) {
    try {
      await nocoRequest(
        'post',
        `/api/v2/tables/${sourceTable.id}/links/${fieldId}/records/${sourceRecordId}`,
        body
      )
      return { ok: true, linked: uniqueIds.length }
    } catch (error: any) {
      const status = error?.response?.status
      const message = describeError(error)
      if (status !== 400 && status !== 422) {
        return { ok: false, error: message }
      }
    }
  }

  return { ok: false, error: 'NocoDB rejected all known link payload shapes.' }
}

async function ensureMentorRows(
  table: TableConfig,
  plans: MentorPlan[]
): Promise<Record<string, NocoRecord>> {
  const existingRows = await fetchRecords(table.id)
  const byName = new Map<string, NocoRecord>()
  for (const row of existingRows) {
    const key = normalizeText(row.Name)
    if (key) {
      byName.set(key, row)
    }
  }

  for (const plan of plans) {
    if (!byName.has(normalizeText(plan.name))) {
      await createRecord(table.id, {
        Name: plan.name,
        'Payment country': ''
      })
      await wait(120)
    }
  }

  const updatedRows = await fetchRecords(table.id)
  const result: Record<string, NocoRecord> = {}
  for (const row of updatedRows) {
    const key = normalizeText(row.Name)
    if (key) {
      result[key] = row
    }
  }

  return result
}

function makeReportDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve(__dirname, '..', '..', 'logs', 'nocodb-sync-mentors', timestamp)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(dir: string, fileName: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main(): Promise<void> {
  assertConfig()
  const apply = process.argv.includes('--apply')
  const dir = makeReportDir()
  const clients = await fetchRecords(TABLES.clients.id)
  const { plans, unmatchedClients } = await loadMentorPlansFromSheet(clients)
  const existingStacks = await fetchRecords(TABLES.stacks.id)
  const stackKeysNeeded = [
    ...new Set(plans.flatMap(plan => plan.stackNames.map(stackKeyForName)))
  ].sort()
  const missingStacks = stackKeysNeeded.filter(
    stackKey => !existingStacks.some(stack => stackDisplayKeys(stack).includes(stackKey))
  )

  writeJson(dir, 'mentor-plans.json', plans)
  writeJson(dir, 'unmatched-clients.json', unmatchedClients)
  writeJson(dir, 'missing-stacks-before-apply.json', missingStacks)

  if (!apply) {
    writeJson(dir, 'summary.json', {
      mode: 'dry-run',
      mentors: plans.length,
      unmatchedClients: unmatchedClients.length,
      missingStacks,
      totalStudentLinks: plans.reduce((sum, plan) => sum + plan.clientIds.length, 0),
      totalStackLinks: plans.reduce((sum, plan) => sum + plan.stackNames.length, 0)
    })
    writeJson(dir, 'apply-result.json', { mode: 'dry-run', applied: false })
    console.log(`NocoDB mentors sync dry-run written to ${dir}`)
    return
  }

  const softSkillsStack = await ensureSoftSkillsStack()
  const mentorsTable = await ensureMentorsTable()
  const columnResult = await ensureMentorColumns(mentorsTable)
  const stackField = await ensureRelationField(mentorsTable, TABLES.stacks, 'Stack')
  const studentsField = await ensureRelationField(mentorsTable, TABLES.clients, 'Students')
  const mentorRowsByName = await ensureMentorRows(mentorsTable, plans)
  const stacks = await fetchRecords(TABLES.stacks.id)
  const linkResults = []

  for (const plan of plans) {
    const mentor = mentorRowsByName[normalizeText(plan.name)]
    if (!mentor) {
      linkResults.push({ plan, ok: false, error: 'Mentor row missing after creation.' })
      continue
    }

    const stackIds = plan.stackNames
      .map(stackName => findStackByName(stacks, stackName)?.Id)
      .filter((value): value is number => typeof value === 'number')
    const studentIds = plan.clientIds

    const stackLink =
      stackField.ok && stackField.id
        ? await linkRecords(mentorsTable, stackField.id, mentor.Id, stackIds)
        : { ok: false, error: stackField.error ?? 'Stack field unavailable.' }
    await wait(120)
    const studentsLink =
      studentsField.ok && studentsField.id
        ? await linkRecords(mentorsTable, studentsField.id, mentor.Id, studentIds)
        : { ok: false, error: studentsField.error ?? 'Students field unavailable.' }

    linkResults.push({
      mentor: plan.name,
      mentorId: mentor.Id,
      stackIds,
      studentIds,
      stackLink,
      studentsLink
    })
    await wait(120)
  }

  writeJson(dir, 'summary.json', {
    mode: 'apply',
    mentors: plans.length,
    unmatchedClients: unmatchedClients.length,
    missingStacksBeforeApply: missingStacks,
    totalStudentLinks: plans.reduce((sum, plan) => sum + plan.clientIds.length, 0),
    totalStackLinks: plans.reduce((sum, plan) => sum + plan.stackNames.length, 0)
  })
  writeJson(dir, 'apply-result.json', {
    mode: 'apply',
    mentorsTable,
    softSkillsStack: {
      Id: softSkillsStack.Id,
      name: softSkillsStack.name
    },
    columnResult,
    relationFields: {
      Stack: stackField,
      Students: studentsField
    },
    linkResults,
    failedLinks: linkResults.filter(
      result => result.stackLink?.ok === false || result.studentsLink?.ok === false
    )
  })
  console.log(`NocoDB mentors sync apply written to ${dir}`)

  if (
    !stackField.ok ||
    !studentsField.ok ||
    linkResults.some(result => result.stackLink?.ok === false || result.studentsLink?.ok === false)
  ) {
    process.exitCode = 1
  }
}

main().catch(error => {
  const message = error?.response?.data ?? error?.message ?? error
  console.error(JSON.stringify(message, null, 2))
  process.exitCode = 1
})
