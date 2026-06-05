const fs = require('node:fs')
const path = require('node:path')
const axios = require('axios')
require('dotenv').config({ quiet: true })
const {
  formatLinkedRecordLabel,
  getLinkedRecord,
  getLinkedRecordId,
  noMigrationRefsEnabled
} = require('../core/relations.ts') as {
  formatLinkedRecordLabel(record: Record<string, unknown> | null | undefined): string
  getLinkedRecord(value: unknown): Record<string, unknown> | null
  getLinkedRecordId(value: unknown): number | null
  noMigrationRefsEnabled(): boolean
}
type NocoRecord = Record<string, unknown> & { Id: number }

type TableConfig = {
  key: string
  id: string
  title: string
}

type LinkPlan = {
  name: string
  childTable: string
  parentTable: string
  childRecordId: number
  parentRecordId: number
  childRef: string
  parentRef: string
  status: RelationStatus
  notes: string
}

type RelationStatus =
  | 'safe_linked'
  | 'warning_missing_dolphin_profile'
  | 'unsafe_needs_review'
  | 'manual_override_linked'

type StatusUpdate = {
  tableKey: string
  recordId: number
  status: RelationStatus
  confidence: 'safe' | 'warning' | 'unsafe' | 'manual'
  notes: string
}

const BASE_URL = (
  process.env.NOCODB_BASE_URL ||
  process.env.nocodb_base_url ||
  'https://app.nocodb.com'
).replace(/\/+$/, '')
const TOKEN = process.env.nocodb_api_token || process.env.NOCODB_API_TOKEN
const BASE_ID = process.env.NOCODB_BASE_ID || 'pqe5susktrsa9z3'

const TABLES: Record<string, TableConfig> = {
  stacks: {
    key: 'stacks',
    id: 'msr3ihfj0kjue1t',
    title: 'stacks'
  },
  clients: {
    key: 'clients',
    id: 'mxza381054ldlza',
    title: 'clients'
  },
  dolphinProfiles: {
    key: 'dolphinProfiles',
    id: 'm4thvbutfyb15qz',
    title: 'dolphin_profiles'
  },
  outreachSettings: {
    key: 'outreachSettings',
    id: 'm3e611iozk7wnew',
    title: 'client_outreach_settings'
  },
  contractsPayments: {
    key: 'contractsPayments',
    id: 'm6jmkkms6o6tkef',
    title: 'contracts_payments'
  },
  platformAccounts: {
    key: 'platformAccounts',
    id: 'm8zej2vsv4iypl8',
    title: 'platform_accounts'
  },
  applications: {
    key: 'applications',
    id: 'mqgr5lv9raft8fm',
    title: 'applications_from_otkliki'
  },
  restrictions: {
    key: 'restrictions',
    id: 'm7bhicp99zq1wsg',
    title: 'client_company_restrictions_from_stop_companies'
  },
  companies: {
    key: 'companies',
    id: 'mcf5h0mryenmxec',
    title: 'companies_from_applications'
  },
  dataStatuses: {
    key: 'dataStatuses',
    id: 'mvyrro4ko9tqu2b',
    title: 'data_collection_statuses'
  },
  resumeProfiles: {
    key: 'resumeProfiles',
    id: 'ms6218eaf2cqqr2',
    title: 'resume_sheet_profiles'
  },
  dolphinMainRaw: {
    key: 'dolphinMainRaw',
    id: 'mes5o0s90zwat1t',
    title: 'dolphin_main_tracking_raw'
  }
}

const CHILD_CLIENT_REF_TABLES = [
  'dolphinProfiles',
  'outreachSettings',
  'contractsPayments',
  'platformAccounts',
  'applications',
  'restrictions'
]

const CHILD_CLIENT_RELATION_FIELDS: Record<string, string> = {
  dolphinProfiles: 'rel_dolphinProfiles_client',
  outreachSettings: 'rel_outreachSettings_client',
  contractsPayments: 'rel_contractsPayments_client',
  platformAccounts: 'rel_platformAccounts_client',
  applications: 'rel_applications_client',
  restrictions: 'rel_restrictions_client'
}

const STATUS_FIELDS = [
  { title: 'relation_status', uidt: 'SingleLineText' },
  { title: 'relation_confidence', uidt: 'SingleLineText' },
  { title: 'relation_notes', uidt: 'LongText' }
]

const RELATION_TABLES = [
  'clients',
  'dolphinProfiles',
  'outreachSettings',
  'contractsPayments',
  'platformAccounts',
  'applications',
  'restrictions',
  'dataStatuses',
  'resumeProfiles',
  'dolphinMainRaw'
]

const RELATION_REVIEW_VIEWS = [
  {
    title: 'Relations - Safe Linked',
    status: 'safe_linked',
    color: '#16A34A'
  },
  {
    title: 'Relations - Yellow Warnings',
    status: 'warning_missing_dolphin_profile',
    color: '#EAB308'
  },
  {
    title: 'Relations - Red Unsafe Review',
    status: 'unsafe_needs_review',
    color: '#DC2626'
  },
  {
    title: 'Relations - Manual Overrides',
    status: 'manual_override_linked',
    color: '#7C3AED'
  }
] as const

const SHOULD_CREATE_REVIEW_VIEWS =
  String(process.env.NOCO_RELATIONS_CREATE_REVIEW_VIEWS ?? '').toLowerCase() === 'true'
const SHOULD_WRITE_TRACE_FIELDS =
  String(process.env.NOCO_RELATIONS_WRITE_TRACE_FIELDS ?? '').toLowerCase() === 'true'

function assertConfig(): void {
  if (!TOKEN) {
    throw new Error('Missing nocodb_api_token in environment')
  }
}

function nocoHeaders(): Record<string, string> {
  return {
    'xc-token': TOKEN as string,
    'Content-Type': 'application/json'
  }
}

async function nocoGet<T>(endpoint: string): Promise<T> {
  return nocoRequest<T>('get', endpoint)
}

async function nocoPost<T>(endpoint: string, body: unknown): Promise<T> {
  return nocoRequest<T>('post', endpoint, body)
}

async function nocoPatch<T>(endpoint: string, body: unknown): Promise<T> {
  return nocoRequest<T>('patch', endpoint, body)
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function nocoRequest<T>(
  method: 'get' | 'post' | 'patch' | 'delete',
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
        headers: nocoHeaders(),
        timeout: 60000
      })
      return response.data
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      const message =
        error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
      if (status !== 429 && !String(message).includes('Too Many Requests')) {
        throw error
      }
    }
  }

  throw lastError
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function normalizeId(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) {
    return ''
  }

  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(raw) || /^[+-]?\d+\.\d+$/.test(raw)) {
    const numberValue = Number(raw)
    if (Number.isFinite(numberValue)) {
      return numberValue.toFixed(0)
    }
  }

  return raw.replace(/\.0$/, '')
}

function isFilled(value: unknown): boolean {
  return String(value ?? '').trim().length > 0
}

function keyBy<T extends NocoRecord>(
  records: T[],
  getKey: (record: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>()

  for (const record of records) {
    const key = getKey(record)
    if (!key) {
      continue
    }

    map.set(key, [...(map.get(key) ?? []), record])
  }

  return map
}

async function fetchTableMeta(table: TableConfig): Promise<any> {
  return nocoGet(`/api/v2/meta/tables/${table.id}`)
}

async function fetchRecords(table: TableConfig): Promise<NocoRecord[]> {
  const all: NocoRecord[] = []
  const limit = 100
  let offset = 0
  let isLastPage = false

  while (!isLastPage) {
    const data = await nocoGet<{
      list: NocoRecord[]
      pageInfo?: { isLastPage?: boolean }
    }>(`/api/v2/tables/${table.id}/records?limit=${limit}&offset=${offset}`)

    all.push(...(data.list ?? []))
    isLastPage = Boolean(data.pageInfo?.isLastPage)
    offset += limit
  }

  return all
}

async function fetchAllRecords(): Promise<Record<string, NocoRecord[]>> {
  const result: Record<string, NocoRecord[]> = {}

  for (const table of Object.values(TABLES)) {
    result[table.key] = await fetchRecords(table)
  }

  return result
}

function findSingleByKey(
  map: Map<string, NocoRecord[]>,
  key: string
): NocoRecord | undefined {
  const matches = map.get(key) ?? []
  return matches.length === 1 ? matches[0] : undefined
}

function buildPlans(records: Record<string, NocoRecord[]>): {
  linkPlans: LinkPlan[]
  statusUpdates: StatusUpdate[]
  recordPatches: Array<{ tableKey: string; recordId: number; patch: Record<string, unknown>; reason: string }>
  unsafe: Record<string, unknown[]>
  warnings: Record<string, unknown[]>
} {
  const clients = records.clients
  const companies = records.companies
  const dolphinProfiles = records.dolphinProfiles

  const companiesByName = keyBy(companies, record => normalizeText(record.company_name))
  const clientsByChat = keyBy(clients, record => normalizeId(record.telegram_general_chat_id))
  const dolphinProfilesByProfileId = keyBy(dolphinProfiles, record =>
    normalizeId(record.dolphin_profile_id)
  )
  const clientsByName = keyBy(clients, record => normalizeText(record.client_name))
  const clientsByFio = keyBy(clients, record => normalizeText(record.fio))

  const linkPlans: LinkPlan[] = []
  const statusUpdates: StatusUpdate[] = []
  const recordPatches: Array<{ tableKey: string; recordId: number; patch: Record<string, unknown>; reason: string }> = []
  const unsafe: Record<string, unknown[]> = {
    missingClientRef: [],
    ambiguousNameOnly: [],
    noNameMatch: [],
    missingStackRef: [],
    unlinkedDolphinProfileId: []
  }
  const warnings: Record<string, unknown[]> = {
    intentionalClientsWithoutPaidProfiles: [],
    legacyDolphinMainProfileIdsWithoutNocoProfile: []
  }

  for (const tableKey of CHILD_CLIENT_REF_TABLES) {
    for (const child of records[tableKey]) {
      const relationField = CHILD_CLIENT_RELATION_FIELDS[tableKey]
      const linkedClientId = relationField ? getLinkedRecordId(child[relationField]) : null
      if (linkedClientId) {
        const linkedClient = clients.find(client => client.Id === linkedClientId)
        linkPlans.push({
          name: `${tableKey}.client`,
          childTable: tableKey,
          parentTable: 'clients',
          childRecordId: child.Id,
          parentRecordId: linkedClientId,
          childRef: String(child.Id),
          parentRef: formatLinkedRecordLabel(linkedClient ?? { Id: linkedClientId }),
          status: 'safe_linked',
          notes: `Native ${relationField} relation is filled.`
        })
        statusUpdates.push({
          tableKey,
          recordId: child.Id,
          status: 'safe_linked',
          confidence: 'safe',
          notes: `Native ${relationField} relation is filled.`
        })
        continue
      }

      unsafe.missingClientRef.push({
        tableKey,
        recordId: child.Id,
        rawClientName: child.raw_client_name ?? child.client_name,
        market: child.market,
        sourceRow: child.source_row,
        noRefMode: noMigrationRefsEnabled()
      })
      statusUpdates.push({
        tableKey,
        recordId: child.Id,
        status: 'unsafe_needs_review',
        confidence: 'unsafe',
        notes: relationField
          ? `Missing native ${relationField} relation; migration ref fallback is disabled.`
          : 'Missing native client relation; name-only row requires manual review.'
      })
    }
  }

  for (const client of clients) {
    const linkedStack = getLinkedRecord(client.rel_clients_primary_stack)
    if (linkedStack?.Id) {
      linkPlans.push({
        name: 'clients.primary_stack',
        childTable: 'clients',
        parentTable: 'stacks',
        childRecordId: client.Id,
        parentRecordId: Number(linkedStack.Id),
        childRef: String(client.Id),
        parentRef: String(linkedStack.Id),
        status: 'safe_linked',
        notes: 'Native rel_clients_primary_stack relation is filled.'
      })
      statusUpdates.push({
        tableKey: 'clients',
        recordId: client.Id,
        status: 'safe_linked',
        confidence: 'safe',
        notes: 'Native rel_clients_primary_stack relation is filled.'
      })
      continue
    }

    unsafe.missingStackRef.push({
      clientId: client.Id,
      clientName: client.client_name,
      noRefMode: noMigrationRefsEnabled()
    })
    statusUpdates.push({
      tableKey: 'clients',
      recordId: client.Id,
      status: 'unsafe_needs_review',
      confidence: 'unsafe',
      notes: 'Missing native rel_clients_primary_stack relation; migration primary_stack_ref fallback is disabled.'
    })
  }

  for (const application of records.applications) {
    const company = findSingleByKey(
      companiesByName,
      normalizeText(application.company_name)
    )
    if (!company) {
      unsafe.noNameMatch.push({
        tableKey: 'applications',
        recordId: application.Id,
        companyName: application.company_name
      })
      statusUpdates.push({
        tableKey: 'applications',
        recordId: application.Id,
        status: 'unsafe_needs_review',
        confidence: 'unsafe',
        notes: `company_name "${application.company_name}" did not resolve to one company.`
      })
      continue
    }

    linkPlans.push({
      name: 'applications.company',
      childTable: 'applications',
      parentTable: 'companies',
      childRecordId: application.Id,
      parentRecordId: company.Id,
      childRef: String(application.company_name),
      parentRef: String(company.company_name),
      status: 'safe_linked',
      notes: 'Exact normalized company_name match.'
    })
  }

  for (const raw of records.dolphinMainRaw) {
    const client = findSingleByKey(
      clientsByChat,
      normalizeId(raw.Id_общего_чата)
    )
    if (client) {
      linkPlans.push({
        name: 'dolphinMainRaw.client',
        childTable: 'dolphinMainRaw',
        parentTable: 'clients',
        childRecordId: raw.Id,
        parentRecordId: client.Id,
        childRef: normalizeId(raw.Id_общего_чата),
        parentRef: formatLinkedRecordLabel(client),
        status: 'safe_linked',
        notes: 'Exact normalized Telegram common chat id match.'
      })
      statusUpdates.push({
        tableKey: 'dolphinMainRaw',
        recordId: raw.Id,
        status: 'safe_linked',
        confidence: 'safe',
        notes: 'Exact normalized Telegram common chat id match.'
      })
    } else {
      unsafe.noNameMatch.push({
        tableKey: 'dolphinMainRaw',
        recordId: raw.Id,
        name: raw.имя,
        chatId: raw.Id_общего_чата
      })
      statusUpdates.push({
        tableKey: 'dolphinMainRaw',
        recordId: raw.Id,
        status: 'unsafe_needs_review',
        confidence: 'unsafe',
        notes: 'Telegram common chat id did not resolve to one client.'
      })
    }

    for (const [fieldName, locale] of [
      ['Dolphin_Profile_Ru_Id', 'Ru'],
      ['Dolphin_Profile_En_Id', 'En']
    ] as const) {
      const profileId = normalizeId(raw[fieldName])
      if (!profileId) {
        continue
      }

      const profile = findSingleByKey(dolphinProfilesByProfileId, profileId)
      if (profile) {
        linkPlans.push({
          name: `dolphinMainRaw.dolphin_profile_${locale.toLowerCase()}`,
          childTable: 'dolphinMainRaw',
          parentTable: 'dolphinProfiles',
          childRecordId: raw.Id,
          parentRecordId: profile.Id,
          childRef: profileId,
          parentRef: String(profile.Id),
          status: 'safe_linked',
          notes: `Exact normalized Dolphin ${locale} profile id match.`
        })
      } else {
        warnings.legacyDolphinMainProfileIdsWithoutNocoProfile.push({
          recordId: raw.Id,
          name: raw.имя,
          locale,
          profileId,
          note: 'Dolphin Main profile ids are legacy/raw tracking data. Missing profile rows are not created from this sheet.'
        })
      }
    }
  }

  const dolphinClientIds = new Set(
    dolphinProfiles
      .map(record => getLinkedRecordId(record.rel_dolphinProfiles_client))
      .filter((id): id is number => Boolean(id))
  )
  for (const client of clients) {
    if (!dolphinClientIds.has(client.Id)) {
      const linkedStack = getLinkedRecord(client.rel_clients_primary_stack)
      warnings.intentionalClientsWithoutPaidProfiles.push({
        clientId: client.Id,
        clientLabel: formatLinkedRecordLabel(client),
        clientName: client.client_name,
        market: client.market,
        stack: linkedStack?.name ?? linkedStack?.stack ?? null,
        note: 'Client has no Dolphin profile row. This is intentional cost saving, not a bug.'
      })
    }
  }

  for (const resume of records.resumeProfiles) {
    let client: NocoRecord | undefined
    let status: RelationStatus = 'safe_linked'
    let confidence: 'safe' | 'manual' = 'safe'
    let notes = 'Native rel_resumeProfiles_client relation is filled.'
    const linkedClientId = getLinkedRecordId(resume.rel_resumeProfiles_client)

    if (linkedClientId) {
      client = clients.find(item => item.Id === linkedClientId)
    } else {
      notes = 'Exact normalized client name/FIO match.'
      const nameMatches = clientsByName.get(normalizeText(resume.raw_client_name)) ?? []
      const fioMatches = clientsByFio.get(normalizeText(resume.full_legal_name)) ?? []
      const uniqueMatches = [...new Map([...nameMatches, ...fioMatches].map(item => [item.Id, item])).values()]
      if (uniqueMatches.length === 1) {
        client = uniqueMatches[0]
      } else if (uniqueMatches.length > 1) {
        unsafe.ambiguousNameOnly.push({
          tableKey: 'resumeProfiles',
          recordId: resume.Id,
          rawClientName: resume.raw_client_name,
          candidates: uniqueMatches.map(item => ({ Id: item.Id, clientName: item.client_name }))
        })
      } else {
        unsafe.noNameMatch.push({
          tableKey: 'resumeProfiles',
          recordId: resume.Id,
          rawClientName: resume.raw_client_name
        })
      }
    }

    if (client) {
      linkPlans.push({
        name: 'resumeProfiles.client',
        childTable: 'resumeProfiles',
        parentTable: 'clients',
        childRecordId: resume.Id,
        parentRecordId: client.Id,
        childRef: String(resume.Id),
        parentRef: String(client.Id),
        status,
        notes
      })
      statusUpdates.push({
        tableKey: 'resumeProfiles',
        recordId: resume.Id,
        status,
        confidence,
        notes
      })
    } else {
      statusUpdates.push({
        tableKey: 'resumeProfiles',
        recordId: resume.Id,
        status: 'unsafe_needs_review',
        confidence: 'unsafe',
        notes: 'Requires clarification: real resume row from migration, but name-only data did not resolve to one client. Do not delete.'
      })
    }
  }

  for (const statusRow of records.dataStatuses) {
    const nameMatches = clientsByName.get(normalizeText(statusRow.ФИ_ученика)) ?? []
    const fioMatches = clientsByFio.get(normalizeText(statusRow.ФИ_ученика)) ?? []
    const uniqueMatches = [...new Map([...nameMatches, ...fioMatches].map(item => [item.Id, item])).values()]
    if (uniqueMatches.length === 1) {
      const client = uniqueMatches[0]
      linkPlans.push({
        name: 'dataStatuses.client',
        childTable: 'dataStatuses',
        parentTable: 'clients',
        childRecordId: statusRow.Id,
        parentRecordId: client.Id,
        childRef: String(statusRow.ФИ_ученика),
        parentRef: formatLinkedRecordLabel(client),
        status: 'safe_linked',
        notes: 'Exact normalized name/FIO match.'
      })
      statusUpdates.push({
        tableKey: 'dataStatuses',
        recordId: statusRow.Id,
        status: 'safe_linked',
        confidence: 'safe',
        notes: 'Exact normalized name/FIO match.'
      })
    } else {
      unsafe.noNameMatch.push({
        tableKey: 'dataStatuses',
        recordId: statusRow.Id,
        sourceRow: statusRow.source_row,
        name: statusRow.ФИ_ученика,
        market: statusRow.Рынок
      })
      statusUpdates.push({
        tableKey: 'dataStatuses',
        recordId: statusRow.Id,
        status: 'unsafe_needs_review',
        confidence: 'unsafe',
      notes: 'Requires clarification: real client row from migration, but name-only data did not resolve to one client. Do not delete.'
      })
    }
  }

  return { linkPlans, statusUpdates, recordPatches, unsafe, warnings }
}

function statusPriority(status: RelationStatus): number {
  switch (status) {
    case 'unsafe_needs_review':
      return 4
    case 'warning_missing_dolphin_profile':
      return 3
    case 'manual_override_linked':
      return 2
    case 'safe_linked':
      return 1
  }
}

function mergeStatusUpdates(updates: StatusUpdate[]): StatusUpdate[] {
  const byRecord = new Map<string, StatusUpdate>()

  for (const update of updates) {
    const key = `${update.tableKey}:${update.recordId}`
    const existing = byRecord.get(key)
    if (!existing || statusPriority(update.status) > statusPriority(existing.status)) {
      byRecord.set(key, update)
    }
  }

  return [...byRecord.values()]
}

async function ensureColumn(
  table: TableConfig,
  title: string,
  uidt: string
): Promise<{ ok: boolean; id?: string; existing: boolean; error?: string }> {
  const meta = await fetchTableMeta(table)
  const existing = (meta.columns ?? []).find((column: any) => column.title === title)
  if (existing) {
    return { ok: true, id: existing.id, existing: true }
  }

  try {
    const created = await nocoPost<any>(`/api/v2/meta/tables/${table.id}/columns`, {
      title,
      uidt
    })
    return { ok: true, id: created?.id, existing: false }
  } catch (error: any) {
    return {
      ok: false,
      existing: false,
      error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
    }
  }
}

async function ensureStatusFields(): Promise<Record<string, unknown[]>> {
  const results: Record<string, unknown[]> = {}

  for (const tableKey of RELATION_TABLES) {
    const table = TABLES[tableKey]
    results[tableKey] = []
    for (const field of STATUS_FIELDS) {
      results[tableKey].push(await ensureColumn(table, field.title, field.uidt))
    }
  }

  return results
}

async function patchRecord(
  tableKey: string,
  recordId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const table = TABLES[tableKey]
  const payload = { Id: recordId, ...patch }
  const attempts = [
    {
      endpoint: `/api/v2/tables/${table.id}/records`,
      body: payload
    },
    {
      endpoint: `/api/v2/tables/${table.id}/records`,
      body: [payload]
    },
    {
      endpoint: `/api/v2/tables/${table.id}/records/${recordId}`,
      body: patch
    }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      await nocoPatch(attempt.endpoint, attempt.body)
      return
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError
}

async function applyStatusUpdates(updates: StatusUpdate[]): Promise<void> {
  for (const update of mergeStatusUpdates(updates)) {
    await patchRecord(update.tableKey, update.recordId, {
      relation_status: update.status,
      relation_confidence: update.confidence,
      relation_notes: update.notes
    })
    await wait(120)
  }
}

async function applyRecordPatches(
  patches: Array<{ tableKey: string; recordId: number; patch: Record<string, unknown> }>
): Promise<void> {
  for (const patch of patches) {
    await patchRecord(patch.tableKey, patch.recordId, patch.patch)
    await wait(120)
  }
}

function linkFieldTitle(planName: string): string {
  return `rel_${planName.replace(/\./g, '_')}`
}

async function ensureLinkField(
  childTableKey: string,
  parentTableKey: string,
  planName: string
): Promise<{ ok: boolean; id?: string; existing: boolean; error?: string }> {
  const childTable = TABLES[childTableKey]
  const parentTable = TABLES[parentTableKey]
  const title = linkFieldTitle(planName)
  const meta = await fetchTableMeta(childTable)
  const existing = (meta.columns ?? []).find((column: any) => column.title === title)

  if (existing) {
    return { ok: true, id: existing.id, existing: true }
  }

  try {
    await nocoPost<any>(`/api/v2/meta/tables/${childTable.id}/columns`, {
      title,
      column_name: title,
      uidt: 'LinkToAnotherRecord',
      type: 'bt',
      childId: childTable.id,
      parentId: parentTable.id
    })

    const updatedMeta = await fetchTableMeta(childTable)
    const createdColumn = (updatedMeta.columns ?? []).find(
      (column: any) => column.title === title
    )

    if (!createdColumn?.id) {
      return {
        ok: false,
        existing: false,
        error: `NocoDB created ${title}, but metadata did not expose its column id.`
      }
    }

    return { ok: true, id: createdColumn.id, existing: false }
  } catch (error: any) {
    return {
      ok: false,
      existing: false,
      error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
    }
  }
}

async function linkRecord(
  plan: LinkPlan,
  fieldId: string
): Promise<{ ok: boolean; error?: string }> {
  const childTable = TABLES[plan.childTable]
  const bodies = [
    [{ Id: plan.parentRecordId }],
    { Id: plan.parentRecordId },
    { data: [{ Id: plan.parentRecordId }] }
  ]

  for (const body of bodies) {
    try {
      await nocoPost(
        `/api/v2/tables/${childTable.id}/links/${fieldId}/records/${plan.childRecordId}`,
        body
      )
      return { ok: true }
    } catch (error: any) {
      const status = error?.response?.status
      const message =
        error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
      if (status !== 400 && status !== 422) {
        return { ok: false, error: message }
      }
    }
  }

  return { ok: false, error: 'NocoDB rejected all known link payload shapes.' }
}

async function applyNativeLinks(linkPlans: LinkPlan[]): Promise<{
  fields: Record<string, unknown>
  linked: number
  failed: unknown[]
}> {
  const uniqueRelationNames = [
    ...new Set(linkPlans.map(plan => `${plan.name}:${plan.childTable}:${plan.parentTable}`))
  ]
  const fieldResults: Record<string, any> = {}

  for (const key of uniqueRelationNames) {
    const [name, childTable, parentTable] = key.split(':')
    fieldResults[name] = await ensureLinkField(childTable, parentTable, name)
  }

  let linked = 0
  const failed: unknown[] = []

  for (const plan of linkPlans) {
    const field = fieldResults[plan.name]
    if (!field?.ok || !field.id) {
      failed.push({ plan, error: field?.error ?? 'Link field is unavailable.' })
      continue
    }

    const result = await linkRecord(plan, field.id)
    if (result.ok) {
      linked += 1
    } else {
      failed.push({ plan, error: result.error })
    }
    await wait(120)
  }

  return { fields: fieldResults, linked, failed }
}

function rowColouringMeta(existingMeta: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...existingMeta,
    rowColoring: RELATION_REVIEW_VIEWS.map(view => ({
      color: view.color,
      where: `(relation_status,eq,${view.status})`
    }))
  }
}

async function attemptRowColouring(): Promise<unknown[]> {
  const results: unknown[] = []

  for (const tableKey of RELATION_TABLES) {
    const table = TABLES[tableKey]
    const meta = await fetchTableMeta(table)
    const views = (meta.views ?? []).filter(
      (view: any) =>
        view?.id &&
        (view.title === table.title || String(view.title ?? '').startsWith('Relations - '))
    )

    for (const view of views) {
      const body = {
        row_coloring_mode: 'row',
        meta: rowColouringMeta(view.meta ?? {})
      }

      try {
        await nocoPatch(`/api/v2/meta/views/${view.id}`, body)
        results.push({ tableKey, ok: true, viewId: view.id, viewTitle: view.title })
      } catch (error: any) {
        results.push({
          tableKey,
          ok: false,
          viewId: view.id,
          viewTitle: view.title,
          error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
        })
      }
      await wait(120)
    }
  }

  return results
}

async function ensureReviewViews(): Promise<unknown[]> {
  const results: unknown[] = []

  for (const tableKey of RELATION_TABLES) {
    const table = TABLES[tableKey]
    const meta = await fetchTableMeta(table)
    const statusColumn = (meta.columns ?? []).find(
      (column: any) => column.title === 'relation_status'
    )

    if (!statusColumn?.id) {
      results.push({
        tableKey,
        ok: false,
        error: 'relation_status field is missing; cannot create filtered review views.'
      })
      continue
    }

    for (const reviewView of RELATION_REVIEW_VIEWS) {
      try {
        const latestMeta = await fetchTableMeta(table)
        let view = (latestMeta.views ?? []).find(
          (candidate: any) => candidate.title === reviewView.title
        )
        let existing = true

        if (!view) {
          view = await createGridView(table, reviewView.title)
          existing = false
        }

        const viewId = view.id
        if (!viewId) {
          throw new Error(`NocoDB did not return a view id for ${reviewView.title}.`)
        }

        await nocoPatch(`/api/v2/meta/views/${viewId}`, {
          row_coloring_mode: 'row',
          meta: rowColouringMeta(view.meta ?? {})
        })

        let filterResult: unknown = { ok: true }
        try {
          const filters = await nocoGet<{ list?: any[] }>(
            `/api/v2/meta/views/${viewId}/filters`
          )
          const existingFilter = (filters.list ?? []).find(
            filter =>
              filter.fk_column_id === statusColumn.id &&
              filter.comparison_op === 'eq' &&
              filter.value === reviewView.status
          )

          if (!existingFilter) {
            await nocoPost(`/api/v2/meta/views/${viewId}/filters`, {
              fk_column_id: statusColumn.id,
              comparison_op: 'eq',
              value: reviewView.status
            })
          }
        } catch (error: any) {
          filterResult = {
            ok: false,
            error:
              error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
          }
        }

        results.push({
          tableKey,
          viewTitle: reviewView.title,
          viewId,
          existing,
          ok: true,
          filterResult
        })
      } catch (error: any) {
        results.push({
          tableKey,
          viewTitle: reviewView.title,
          ok: false,
          error: error?.response?.data?.message ?? error?.response?.data?.msg ?? error.message
        })
      }
      await wait(120)
    }
  }

  return results
}

async function createGridView(table: TableConfig, title: string): Promise<any> {
  const attempts = [
    { endpoint: `/api/v2/meta/tables/${table.id}/grids`, body: { title } },
    { endpoint: `/api/v1/db/meta/tables/${table.id}/grids`, body: { title } },
    { endpoint: `/api/v2/meta/tables/${table.id}/views`, body: { title, type: 3 } },
    { endpoint: `/api/v1/db/meta/tables/${table.id}/views`, body: { title, type: 3 } }
  ]
  let lastError: any

  for (const attempt of attempts) {
    try {
      return await nocoPost<any>(attempt.endpoint, attempt.body)
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      if (status !== 400 && status !== 404 && status !== 405 && status !== 422) {
        throw error
      }
    }
  }

  throw lastError
}

function makeReportDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve(
    __dirname,
    '..',
    '..',
    'logs',
    'nocodb-relations',
    timestamp
  )
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function summarizePlans(
  records: Record<string, NocoRecord[]>,
  plans: ReturnType<typeof buildPlans>
): Record<string, unknown> {
  const statusCounts = mergeStatusUpdates(plans.statusUpdates).reduce(
    (acc: Record<string, number>, update) => {
      acc[update.status] = (acc[update.status] ?? 0) + 1
      return acc
    },
    {}
  )

  return {
    counts: Object.fromEntries(
      Object.entries(records).map(([key, value]) => [key, value.length])
    ),
    linkPlans: plans.linkPlans.length,
    statusUpdates: mergeStatusUpdates(plans.statusUpdates).length,
    statusCounts,
    recordPatches: plans.recordPatches,
    unsafeCounts: Object.fromEntries(
      Object.entries(plans.unsafe).map(([key, value]) => [key, value.length])
    ),
    warningCounts: Object.fromEntries(
      Object.entries(plans.warnings).map(([key, value]) => [key, value.length])
    )
  }
}

async function main(): Promise<void> {
  assertConfig()
  const args = new Set(process.argv.slice(2))
  const apply = args.has('--apply')
  const dryRun = args.has('--dry-run') || !apply
  const dir = makeReportDir()
  const records = await fetchAllRecords()
  const plans = buildPlans(records)

  writeJson(dir, 'summary.json', summarizePlans(records, plans))
  writeJson(dir, 'safe-link-plans.json', plans.linkPlans)
  writeJson(dir, 'status-updates.json', mergeStatusUpdates(plans.statusUpdates))
  writeJson(dir, 'unsafe.json', plans.unsafe)
  writeJson(dir, 'warnings.json', plans.warnings)

  if (dryRun) {
    writeJson(dir, 'apply-result.json', {
      mode: 'dry-run',
      applied: false
    })
    console.log(`NocoDB relations dry-run written to ${dir}`)
    return
  }

  await applyRecordPatches(plans.recordPatches)
  const statusFieldResult = SHOULD_WRITE_TRACE_FIELDS
    ? await ensureStatusFields()
    : { skipped: true, reason: 'NOCO_RELATIONS_WRITE_TRACE_FIELDS is not true.' }
  const statusUpdateResult = SHOULD_WRITE_TRACE_FIELDS
    ? await applyStatusUpdates(plans.statusUpdates).then(() => ({
        applied: mergeStatusUpdates(plans.statusUpdates).length
      }))
    : { skipped: true, reason: 'NOCO_RELATIONS_WRITE_TRACE_FIELDS is not true.' }
  const nativeLinksResult = await applyNativeLinks(plans.linkPlans)
  const reviewViewsResult = SHOULD_CREATE_REVIEW_VIEWS
    ? await ensureReviewViews()
    : { skipped: true, reason: 'NOCO_RELATIONS_CREATE_REVIEW_VIEWS is not true.' }
  const rowColouringResult = SHOULD_CREATE_REVIEW_VIEWS
    ? await attemptRowColouring()
    : { skipped: true, reason: 'NOCO_RELATIONS_CREATE_REVIEW_VIEWS is not true.' }

  writeJson(dir, 'apply-result.json', {
    mode: 'apply',
    statusFieldResult,
    statusUpdateResult,
    recordPatches: plans.recordPatches,
    nativeLinksResult,
    reviewViewsResult,
    rowColouringResult
  })

  console.log(`NocoDB relations apply written to ${dir}`)
}

main().catch(error => {
  const message = error?.response?.data ?? error?.message ?? error
  console.error(JSON.stringify(message, null, 2))
  process.exitCode = 1
})
