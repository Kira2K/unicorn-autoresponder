const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>
}
const { RELATIONS } = require('../../../integrations/noco/core/schema.ts') as {
  RELATIONS: Record<string, string>
}

type ClientDashboard = import('./types.ts').ClientDashboard
type ClientProfilePatch = import('./types.ts').ClientProfilePatch
type PlatformAccountInput = import('./types.ts').PlatformAccountInput
type WebClient = import('./types.ts').WebClient
type WebConsoleRepository = import('./types.ts').WebConsoleRepository
type WebOption = import('./types.ts').WebOption
type WebPlatformAccount = import('./types.ts').WebPlatformAccount
type ProviderClientRow = import('./types.ts').ProviderClientRow
type ResumeWorkflowPatch = import('./types.ts').ResumeWorkflowPatch
type ResumeWorkflowRecord = import('./types.ts').ResumeWorkflowRecord

type NocoRecord = Record<string, unknown> & { Id: number }
type NocoSelectOption = { id?: string; Id?: string | number; title?: string; name?: string; label?: string }
const LINKEDIN_PLATFORM_ID = 16

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeId(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(raw) || /^[+-]?\d+\.\d+$/.test(raw)) {
    const numberValue = Number(raw)
    if (Number.isFinite(numberValue)) return numberValue.toFixed(0)
  }
  return raw.replace(/\.0$/, '')
}

function normalizeStatusText(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ').toLowerCase()
}

function linkedRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  return Array.isArray(value)
    ? value as Array<Record<string, unknown>>
    : [value as Record<string, unknown>]
}

function linkedId(value: unknown): number | null {
  const record = linkedRecords(value)[0]
  const id = Number(record?.Id ?? record?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function linkedName(value: unknown): string {
  const record = linkedRecords(value)[0]
  return normalizeText(record?.name ?? record?.stack ?? record?.label ?? record?.market ?? record?.level)
}

function linkedLabel(value: unknown): string {
  const record = linkedRecords(value)[0]
  return normalizeText(record?.label ?? record?.name ?? record?.title)
}

function linkedNames(value: unknown): string[] {
  return linkedRecords(value)
    .map(record => normalizeText(record.Name ?? record.name ?? record.label ?? record.title))
    .filter(Boolean)
}

function displayText(value: unknown): string {
  if (value && typeof value === 'object') {
    return optionTitle(linkedRecords(value)[0] ?? {})
  }
  return normalizeText(value)
}

function optionId(value: unknown): string {
  return normalizeText(value)
}

function optionTitle(option: NocoSelectOption): string {
  return normalizeText(option.title ?? option.name ?? option.label)
}

function findSelectOption(options: NocoSelectOption[], label: string): NocoSelectOption | undefined {
  const expected = normalizeStatusText(label)
  return options.find(option => normalizeStatusText(optionTitle(option)) === expected)
}

function linkedStatusMatches(
  value: unknown,
  expectedLabel: string,
  options: NocoSelectOption[] = []
): boolean {
  const expectedOption = findSelectOption(options, expectedLabel)
  const expectedOptionId = optionId(expectedOption?.id ?? expectedOption?.Id)
  if (!expectedOptionId) return false

  const linkedMatch = linkedRecords(value).some(record => {
    const recordOptionId = optionId(record.id ?? record.Id)
    return recordOptionId === expectedOptionId
  })
  if (linkedMatch) return true

  if (typeof value === 'string') {
    const recordOption = findSelectOption(options, value)
    const recordOptionId = optionId(recordOption?.id ?? recordOption?.Id)
    return Boolean(recordOptionId && recordOptionId === expectedOptionId)
  }

  return false
}

function accountClientId(account: NocoRecord): number | null {
  const id = linkedId(account.rel_platformAccounts_client) ?? Number(account.clients_id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function accountPlatformId(account: NocoRecord): number | null {
  const id = linkedId(account.rel_platformAccounts_platform) ?? Number(account.platforms_id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function profileClientId(profile: NocoRecord): number | null {
  const id = linkedId(profile.rel_dolphinProfiles_client) ?? Number(profile.clients_id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function profileId(profile: NocoRecord): number | null {
  const id = Number(normalizeId(profile.dolphin_profile_id))
  return Number.isFinite(id) && id > 0 ? id : null
}

function profileLocale(profile: NocoRecord): string {
  return normalizeText(profile.locale).toLowerCase()
}

function profileLocaleSortValue(profile: NocoRecord): number {
  const locale = normalizeText(profile.locale).toLowerCase()
  if (locale === 'ru') return 0
  if (locale === 'en') return 1
  return 2
}

function uniqueSortedProfileIds(profiles: NocoRecord[]): number[] {
  const ids = profiles
    .sort((a, b) => profileLocaleSortValue(a) - profileLocaleSortValue(b) || Number(a.Id) - Number(b.Id))
    .map(profileId)
    .filter((id): id is number => Boolean(id))
  return [...new Set(ids)]
}

function isLinkedInPlatformAccount(account: NocoRecord): boolean {
  return accountPlatformId(account) === LINKEDIN_PLATFORM_ID
}

function buildLinkedInEmailByClientId(accounts: NocoRecord[]): Map<number, string> {
  const grouped = new Map<number, string[]>()
  for (const account of accounts.filter(isLinkedInPlatformAccount).sort((a, b) => Number(a.Id) - Number(b.Id))) {
    const clientId = accountClientId(account)
    const login = normalizeText(account.login)
    if (!clientId || !login) continue
    grouped.set(clientId, [...(grouped.get(clientId) ?? []), login])
  }
  return new Map([...grouped.entries()].map(([clientId, logins]) => [clientId, logins.join(', ')]))
}

function toClient(record: NocoRecord): WebClient {
  const realAge = Number(record.real_age)
  return {
    id: Number(record.Id),
    clientName: normalizeText(record.client_name),
    firstName: normalizeText(record.first_name),
    lastName: normalizeText(record.last_name),
    fio: normalizeText(record.fio),
    birthDate: normalizeText(record.birth_date),
    education: normalizeText(record.education),
    realAge: Number.isFinite(realAge) ? realAge : undefined,
    stopListCompany: normalizeText(record.stop_list_company),
    calendarEmail: normalizeText(record.calendar_email),
    googleFolder: normalizeText(record.google_folder),
    telegramPersonalChatId: normalizeText(record.telegram_personal_chat_id),
    commonChatId: normalizeText(record.telegram_general_chat_id),
    primaryStack: linkedName(record.rel_clients_primary_stack) || undefined,
    market: linkedName(record.market) || normalizeText(record.market) || undefined,
    clientStatus: displayText(record.client_status) || undefined,
    clientStatusNote: normalizeText(record.client_status_note) || undefined,
    resumeStatus: normalizeText(record.resume_status) || undefined,
    linkedInStatus: normalizeText(record.linkedin_status) || undefined,
    englishLevelId: (linkedId(record['English level']) ?? Number(record.english_levels_id)) || undefined,
    englishLevel: linkedName(record['English level']) || undefined,
    mentors: linkedNames(record.Mentors)
  }
}

function toProviderClientRow(record: NocoRecord, linkedInEmail = ''): ProviderClientRow {
  return {
    id: Number(record.Id),
    clientName: normalizeText(record.client_name),
    primaryStack: linkedName(record.rel_clients_primary_stack) || undefined,
    linkedInEmail
  }
}

function telegramPlatformIds(platforms: NocoRecord[]): Set<number> {
  const telegramPlatformLabels = new Set(['telegram_ru', 'telegram_en'])
  return new Set(platforms
    .filter(platform => {
      const canonicalValues = [platform.label, platform.platform, platform.name]
        .map(value => normalizeStatusText(value).replace(/\s+/g, '_'))
      return canonicalValues.some(value => telegramPlatformLabels.has(value))
    })
    .map(platform => Number(platform.Id))
    .filter(id => Number.isFinite(id) && id > 0))
}

function isTelegramPlatformAccount(account: NocoRecord, platformIds: Set<number>): boolean {
  const platformId = accountPlatformId(account)
  return platformId !== null && platformIds.has(platformId)
}

function cvProcessingClientId(record: NocoRecord): number | null {
  const id = linkedId(record.client) ?? linkedId(record.clients) ?? Number(record.clients_id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function toResumeWorkflow(record: NocoRecord, client?: NocoRecord | WebClient): ResumeWorkflowRecord {
  const clientId = cvProcessingClientId(record) ?? Number((client as any)?.Id ?? (client as any)?.id)
  const clientName = normalizeText(
    (client as any)?.client_name ??
    (client as any)?.clientName ??
    linkedName(record.client) ??
    record.record_key
  )
  const clientMarket =
    linkedName((client as any)?.market) ||
    normalizeText((client as any)?.market)
  const clientStack =
    linkedName((client as any)?.rel_clients_primary_stack) ||
    normalizeText((client as any)?.primaryStack ?? (client as any)?.primary_stack)
  const englishLevelId =
    (linkedId((client as any)?.['English level']) ?? Number((client as any)?.english_levels_id ?? (client as any)?.englishLevelId)) || undefined
  const englishLevel =
    linkedName((client as any)?.['English level']) ||
    normalizeText((client as any)?.englishLevel ?? (client as any)?.english_level)
  return {
    id: Number(record.Id),
    clientId,
    clientName,
    clientMarket: clientMarket || undefined,
    clientStack: clientStack || undefined,
    clientTelegramUsername: normalizeText((client as any)?.telegram_personal_chat_id ?? (client as any)?.telegramPersonalChatId) || undefined,
    clientGoogleFolder: normalizeText((client as any)?.google_folder ?? (client as any)?.googleFolder) || undefined,
    commonChatId: normalizeText((client as any)?.telegram_general_chat_id ?? (client as any)?.commonChatId) || undefined,
    education: normalizeText((client as any)?.education) || undefined,
    englishLevel,
    englishLevelId,
    status: normalizeText(record.status),
    studentDataFolderUrl: normalizeText(record.student_data_folder_url ?? record.student_experience_folder_url),
    cvDraftUrl: normalizeText(record.cv_draft_url),
    enVersionUrl: normalizeText(record.en_version_url),
    ruVersionUrl: normalizeText(record.ru_version_url),
    additionalVersions: normalizeText(record.additional_versions),
    kirasComments: normalizeText(record.kiras_comments),
    lastResponsible: normalizeText(record.last_responsible),
    lastWorkflowError: normalizeText(record.last_workflow_error),
    workflowTrace: normalizeText(record.workflow_trace)
  }
}

function buildResumeWorkflowPatch(input: ResumeWorkflowPatch): Record<string, unknown> {
  const fields: Array<[keyof ResumeWorkflowPatch, string]> = [
    ['status', 'status'],
    ['studentDataFolderUrl', 'student_data_folder_url'],
    ['cvDraftUrl', 'cv_draft_url'],
    ['enVersionUrl', 'en_version_url'],
    ['ruVersionUrl', 'ru_version_url'],
    ['additionalVersions', 'additional_versions'],
    ['kirasComments', 'kiras_comments'],
    ['lastResponsible', 'last_responsible'],
    ['lastWorkflowError', 'last_workflow_error'],
    ['workflowTrace', 'workflow_trace']
  ]
  const patch: Record<string, unknown> = {}
  for (const [inputField, nocoField] of fields) {
    if (input[inputField] !== undefined) patch[nocoField] = normalizeText(input[inputField])
  }
  return patch
}

function maskSecret(value: unknown, fullAccess: boolean): string | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  return fullAccess ? text : '***'
}

function toPlatformAccount(record: NocoRecord, fullAccess: boolean, telegramIds: Set<number> = new Set()): WebPlatformAccount {
  return {
    id: Number(record.Id),
    clientId: accountClientId(record) || undefined,
    platform: normalizeText(record.platform || linkedName(record.rel_platformAccounts_platform)),
    platformId: accountPlatformId(record) || undefined,
    isTelegramAccount: isTelegramPlatformAccount(record, telegramIds),
    accountLabel: normalizeText(record.account_label || record.label || record.platform || linkedLabel(record.rel_platformAccounts_platform)),
    login: normalizeText(record.login),
    phone: normalizeText(record.phone || record.phone_en),
    email: normalizeText(record.email),
    nickname: normalizeText(record.nickname) || undefined,
    linkedInUrl: normalizeText(record.linkedin_url) || undefined,
    foreignNumber: normalizeText(record.foreign_number) || undefined,
    recoveryCodes: normalizeText(record.recovery_codes) || undefined,
    password: maskSecret(record.password, fullAccess),
    emailPassword: maskSecret(record.email_password, fullAccess),
    telegramSessionStatus: normalizeText(record.telegram_session_status) || undefined,
    telegramTdlibDbPath: normalizeText(record.telegram_tdlib_db_path) || undefined,
    telegramLastActive: normalizeText(record.telegram_last_active) || undefined,
    telegramEventLog: normalizeText(record.telegram_event_log) || undefined
  }
}

function sortByIdDesc(a: NocoRecord, b: NocoRecord): number {
  return Number(b.Id) - Number(a.Id)
}

function optionLabel(record: NocoRecord, fields: string[]): string {
  for (const field of fields) {
    const value = normalizeText(record[field])
    if (value) return value
  }
  return String(record.Id)
}

function toOption(record: NocoRecord, fields: string[]): WebOption {
  return {
    id: Number(record.Id),
    label: optionLabel(record, fields)
  }
}

function cleanOptionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return normalizeText(value)
}

function cleanNullableId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? id : null
}

function cleanNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function buildClientPatch(input: ClientProfilePatch): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const textFields: Array<[keyof ClientProfilePatch, string]> = [
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
    ['fio', 'fio'],
    ['birthDate', 'birth_date'],
    ['education', 'education'],
    ['stopListCompany', 'stop_list_company'],
    ['telegramPersonalChatId', 'telegram_personal_chat_id'],
    ['calendarEmail', 'calendar_email']
  ]
  for (const [inputField, nocoField] of textFields) {
    const value = cleanOptionalText(input[inputField])
    if (value !== undefined) patch[nocoField] = value
  }
  const englishLevelId = cleanNullableId(input.englishLevelId)
  if (englishLevelId !== undefined) patch.english_levels_id = englishLevelId
  const realAge = cleanNullableNumber(input.realAge)
  if (realAge !== undefined) patch.real_age = realAge
  return patch
}

function buildChangedClientPatch(current: WebClient, input: ClientProfilePatch): Record<string, unknown> {
  const patch = buildClientPatch(input)
  const currentByNocoField: Record<string, unknown> = {
    first_name: current.firstName,
    last_name: current.lastName,
    fio: current.fio,
    birth_date: current.birthDate,
    education: current.education,
    real_age: current.realAge ?? null,
    stop_list_company: current.stopListCompany,
    telegram_personal_chat_id: current.telegramPersonalChatId,
    calendar_email: current.calendarEmail,
    english_levels_id: current.englishLevelId ?? null
  }

  for (const [field, value] of Object.entries(patch)) {
    const currentValue = currentByNocoField[field]
    if (field === 'english_levels_id') {
      if ((Number(value) || null) === (Number(currentValue) || null)) {
        delete patch[field]
      }
      continue
    }
    if (field === 'real_age') {
      if ((Number(value) || null) === (Number(currentValue) || null)) {
        delete patch[field]
      }
      continue
    }
    if (normalizeText(value) === normalizeText(currentValue)) {
      delete patch[field]
    }
  }

  return patch
}

function buildAccountPatch(input: PlatformAccountInput, options: { includeBlankSecrets: boolean }): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const textFields: Array<[keyof PlatformAccountInput, string]> = [
    ['platform', 'platform'],
    ['accountLabel', 'account_label'],
    ['login', 'login'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['nickname', 'nickname'],
    ['linkedInUrl', 'linkedin_url'],
    ['foreignNumber', 'foreign_number'],
    ['recoveryCodes', 'recovery_codes']
  ]
  for (const [inputField, nocoField] of textFields) {
    const value = cleanOptionalText(input[inputField])
    if (value !== undefined) patch[nocoField] = value
  }
  const platformId = cleanNullableId(input.platformId)
  if (platformId !== undefined) patch.platforms_id = platformId

  const secretFields: Array<[keyof PlatformAccountInput, string]> = [
    ['password', 'password'],
    ['emailPassword', 'email_password']
  ]
  for (const [inputField, nocoField] of secretFields) {
    const value = cleanOptionalText(input[inputField])
    if (value === undefined) continue
    if (value || options.includeBlankSecrets) patch[nocoField] = value
  }
  return patch
}

function notFoundError(message: string): Error & { code?: string } {
  const error = new Error(message) as Error & { code?: string }
  error.code = 'not_found'
  return error
}

function extractCreatedRecordId(value: any): number | null {
  if (typeof value?.Id === 'number') return value.Id
  if (typeof value?.id === 'number') return value.id
  if (Array.isArray(value) && value[0]) return extractCreatedRecordId(value[0])
  if (Array.isArray(value?.list) && value.list[0]) return extractCreatedRecordId(value.list[0])
  return null
}

function createWebConsoleRepository(options: { nocoClient?: any } = {}): WebConsoleRepository {
  const nocoClient = options.nocoClient ?? createNocoClient()

  async function fetchClients(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.clients.id, 1000)
  }

  async function fetchPlatformAccounts(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.platformAccounts.id, 1000)
  }

  async function fetchPlatformAccountsForClient(clientId: number): Promise<NocoRecord[]> {
    if (typeof nocoClient.fetchRecords === 'function') {
      const records = await nocoClient.fetchRecords(TABLES.platformAccounts.id, 1000, {
        where: `(clients_id,eq,${Number(clientId)})`
      }) as NocoRecord[]
      return records.filter(account => accountClientId(account) === Number(clientId))
    }
    return (await fetchPlatformAccounts()).filter(account => accountClientId(account) === Number(clientId))
  }

  async function fetchDolphinProfiles(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.dolphinProfiles.id, 1000)
  }

  async function fetchEnglishLevels(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.englishLevels.id, 1000)
  }

  async function fetchPlatforms(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.platforms.id, 1000)
  }

  async function fetchCvProcessing(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.cvProcessing.id, 1000)
  }

  async function fetchClientStatusOptions(): Promise<NocoSelectOption[]> {
    if (typeof nocoClient.fetchTableMeta !== 'function') return []
    const meta = await nocoClient.fetchTableMeta(TABLES.clients.id)
    const statusColumn = (meta.columns ?? []).find((column: any) => column.title === 'client_status')
    return statusColumn?.colOptions?.options ?? []
  }

  async function dashboardForClient(client: NocoRecord, fullAccess = false): Promise<ClientDashboard> {
    const telegramIds = telegramPlatformIds(await fetchPlatforms())
    const clientPlatformAccounts = (await fetchPlatformAccountsForClient(Number(client.Id)))
      .sort((a, b) => Number(a.Id) - Number(b.Id))
    const linkedInEmailByClientId = buildLinkedInEmailByClientId(clientPlatformAccounts)
    const platformAccounts = clientPlatformAccounts
      .map(account => toPlatformAccount(account, fullAccess, telegramIds))

    return {
      client: toClient(client),
      platformAccounts,
      linkedInEmail: linkedInEmailByClientId.get(Number(client.Id)) ?? ''
    }
  }

  async function getOwnedPlatformAccount(clientId: number, accountId: number): Promise<NocoRecord> {
    const account = (await fetchPlatformAccountsForClient(clientId))
      .find(candidate => Number(candidate.Id) === Number(accountId) && accountClientId(candidate) === Number(clientId))
    if (!account) throw notFoundError(`Platform account ${accountId} was not found for client ${clientId}.`)
    return account
  }

  async function refetchDashboard(clientId: number, fullAccess = false): Promise<ClientDashboard> {
    const clients = await fetchClients()
    const client = clients.find(candidate => Number(candidate.Id) === Number(clientId))
    if (!client) throw notFoundError(`Client ${clientId} was not found`)
    return await dashboardForClient(client, fullAccess)
  }

  async function findClientRecordByTelegramChatId(chatId: string): Promise<NocoRecord | null> {
    const normalized = normalizeId(chatId)
    if (!normalized) return null
    const clients = await fetchClients()
    return clients.find(candidate => normalizeId(candidate.telegram_general_chat_id) === normalized) ?? null
  }

  async function findCvProcessingRecordByClientId(clientId: number): Promise<NocoRecord | null> {
    const records = await fetchCvProcessing()
    return records
      .sort((a, b) => Number(a.Id) - Number(b.Id))
      .find(record => cvProcessingClientId(record) === Number(clientId)) ?? null
  }

  async function ensureCvProcessingRecordForClient(client: NocoRecord): Promise<NocoRecord> {
    const existing = await findCvProcessingRecordByClientId(Number(client.Id))
    if (existing) return existing
    const created = await nocoClient.createRecord(TABLES.cvProcessing.id, {
      record_key: normalizeText(client.client_name) || `client:${client.Id}`,
      clients_id: Number(client.Id),
      status: "collection student's data",
      student_data_folder_url: '',
      cv_draft_url: '',
      en_version_url: '',
      ru_version_url: '',
      additional_versions: '',
      kiras_comments: '',
      last_responsible: 'student',
      last_workflow_error: '',
      workflow_trace: ''
    }) as NocoRecord
    return Array.isArray(created) ? created[0] : created
  }

  async function findDolphinProfileClientRelationFieldId(): Promise<string | null> {
    if (typeof nocoClient.fetchTableMeta !== 'function') return null
    const meta = await nocoClient.fetchTableMeta(TABLES.dolphinProfiles.id)
    const columns = meta.columns ?? []
    const byTitle = columns.find((column: any) => column.title === RELATIONS.dolphinProfilesClient)
    if (byTitle?.id) return byTitle.id
    const byRelatedClient = columns.find((column: any) => {
      const options = column.colOptions ?? {}
      return (
        (column.uidt === 'LinkToAnotherRecord' || column.uidt === 'Links') &&
        (options.fk_related_model_id === TABLES.clients.id ||
          options.fk_parent_model_id === TABLES.clients.id)
      )
    })
    return byRelatedClient?.id ?? null
  }

  async function linkDolphinProfileToClient(profileRecordId: number, clientId: number): Promise<void> {
    if (typeof nocoClient.request !== 'function') return
    const relationFieldId = await findDolphinProfileClientRelationFieldId()
    if (!relationFieldId) return
    const bodies = [
      [{ Id: clientId }],
      { Id: clientId },
      { data: [{ Id: clientId }] }
    ]
    let lastError: any
    for (const body of bodies) {
      try {
        await nocoClient.request(
          'post',
          `/api/v2/tables/${TABLES.dolphinProfiles.id}/links/${relationFieldId}/records/${profileRecordId}`,
          body
        )
        return
      } catch (error: any) {
        lastError = error
        const status = error?.response?.status
        if (status !== 400 && status !== 404 && status !== 422) throw error
      }
    }
    throw lastError ?? new Error('NocoDB rejected all known Dolphin profile relation payloads.')
  }

  return {
    async findClientByCalendarEmail(email: string): Promise<WebClient | null> {
      const normalized = normalizeEmail(email)
      const clients = await fetchClients()
      const match = clients.find(client => normalizeEmail(client.calendar_email) === normalized)
      return match ? toClient(match) : null
    },

    async getAllDolphinProfileIds(): Promise<number[]> {
      return uniqueSortedProfileIds(await fetchDolphinProfiles())
    },

    async getClientDashboard(clientId: number, options: { fullAccess?: boolean } = {}): Promise<ClientDashboard> {
      const clients = await fetchClients()
      const client = clients.find(candidate => Number(candidate.Id) === Number(clientId))
      if (!client) throw new Error(`Client ${clientId} was not found`)
      return await dashboardForClient(client, Boolean(options.fullAccess))
    },

    async getClientById(clientId: number): Promise<WebClient> {
      const clients = await fetchClients()
      const client = clients.find(candidate => Number(candidate.Id) === Number(clientId))
      if (!client) throw notFoundError(`Client ${clientId} was not found`)
      return toClient(client)
    },

    async getDolphinProfileIdsForClient(clientId: number): Promise<number[]> {
      const profiles = await fetchDolphinProfiles()
      return uniqueSortedProfileIds(profiles.filter(profile => profileClientId(profile) === Number(clientId)))
    },

    async getDolphinProfilesForClient(clientId: number): Promise<Array<{ id: number; locale: string }>> {
      const profiles = await fetchDolphinProfiles()
      return profiles
        .filter(profile => profileClientId(profile) === Number(clientId))
        .map(profile => ({ id: profileId(profile), locale: profileLocale(profile) }))
        .filter((profile): profile is { id: number; locale: string } => Boolean(profile.id))
        .sort((a, b) => (a.locale === 'ru' ? 0 : a.locale === 'en' ? 1 : 2) - (b.locale === 'ru' ? 0 : b.locale === 'en' ? 1 : 2) || a.id - b.id)
    },

    async getLatestClientDashboard(options: { fullAccess?: boolean } = {}): Promise<ClientDashboard> {
      const clients = await fetchClients()
      const client = [...clients].sort(sortByIdDesc)[0]
      if (!client) throw new Error('No clients found')
      return await dashboardForClient(client, Boolean(options.fullAccess))
    },

    async findClientByTelegramChatId(chatId: string): Promise<WebClient | null> {
      const client = await findClientRecordByTelegramChatId(chatId)
      return client ? toClient(client) : null
    },

    async updateGoogleFolderByTelegramChatId(chatId: string, googleFolder: string): Promise<WebClient | null> {
      const client = await findClientRecordByTelegramChatId(chatId)
      if (!client) return null
      await nocoClient.patchRecord(TABLES.clients.id, Number(client.Id), { google_folder: normalizeText(googleFolder) })
      const updated = await refetchDashboard(Number(client.Id))
      return updated.client
    },

    async getResumeWorkflowByTelegramChatId(chatId: string, options: { ensure?: boolean } = {}): Promise<ResumeWorkflowRecord | null> {
      const client = await findClientRecordByTelegramChatId(chatId)
      if (!client) return null
      const record = options.ensure
        ? await ensureCvProcessingRecordForClient(client)
        : await findCvProcessingRecordByClientId(Number(client.Id))
      if (!record) return null
      return toResumeWorkflow(record, client)
    },

    async getResumeWorkflowById(workflowId: number): Promise<ResumeWorkflowRecord | null> {
      const records = await fetchCvProcessing()
      const record = records.find(candidate => Number(candidate.Id) === Number(workflowId))
      if (!record) return null
      const clientId = cvProcessingClientId(record)
      const client = clientId ? (await fetchClients()).find(candidate => Number(candidate.Id) === clientId) : undefined
      return toResumeWorkflow(record, client)
    },

    async getProviderResumeTasks(): Promise<ResumeWorkflowRecord[]> {
      const [clients, records] = await Promise.all([fetchClients(), fetchCvProcessing()])
      const clientsById = new Map(clients.map(client => [Number(client.Id), client]))
      return records
        .sort((a, b) => Number(a.Id) - Number(b.Id))
        .map(record => {
          const clientId = cvProcessingClientId(record)
          return toResumeWorkflow(record, clientId ? clientsById.get(clientId) : undefined)
        })
    },

    async patchResumeWorkflow(recordId: number, input: ResumeWorkflowPatch): Promise<ResumeWorkflowRecord> {
      const patch = buildResumeWorkflowPatch(input)
      if (Object.keys(patch).length) {
        await nocoClient.patchRecord(TABLES.cvProcessing.id, Number(recordId), patch)
      }
      const records = await fetchCvProcessing()
      const record = records.find(candidate => Number(candidate.Id) === Number(recordId))
      if (!record) throw notFoundError(`CV processing row ${recordId} was not found`)
      const clientId = cvProcessingClientId(record)
      const client = clientId ? (await fetchClients()).find(candidate => Number(candidate.Id) === clientId) : undefined
      return toResumeWorkflow(record, client)
    },

    async getProviderClientByIdForStatus(clientId: number, statusLabel: string): Promise<ProviderClientRow | null> {
      const clients = await fetchClients()
      const statusOptions = await fetchClientStatusOptions()
      const client = clients.find(candidate =>
        Number(candidate.Id) === Number(clientId) &&
        linkedStatusMatches(candidate.client_status, statusLabel, statusOptions)
      )
      if (!client) return null
      const linkedInEmailByClientId = buildLinkedInEmailByClientId(await fetchPlatformAccounts())
      return toProviderClientRow(client, linkedInEmailByClientId.get(Number(client.Id)) ?? '')
    },

    async getProviderClientsForStatus(statusLabel: string): Promise<ProviderClientRow[]> {
      const [clients, platformAccounts] = await Promise.all([fetchClients(), fetchPlatformAccounts()])
      const statusOptions = await fetchClientStatusOptions()
      const linkedInEmailByClientId = buildLinkedInEmailByClientId(platformAccounts)
      return clients
        .filter(client => linkedStatusMatches(client.client_status, statusLabel, statusOptions))
        .sort((a, b) => Number(a.Id) - Number(b.Id))
        .map(client => toProviderClientRow(client, linkedInEmailByClientId.get(Number(client.Id)) ?? ''))
    },

    async listEnglishLevels(): Promise<WebOption[]> {
      return (await fetchEnglishLevels())
        .sort((a, b) => Number(a.rank ?? a.Id) - Number(b.rank ?? b.Id))
        .map(record => toOption(record, ['level', 'name', 'label']))
    },

    async listPlatforms(): Promise<WebOption[]> {
      return (await fetchPlatforms())
        .sort((a, b) => optionLabel(a, ['label', 'platform', 'name']).localeCompare(optionLabel(b, ['label', 'platform', 'name'])))
        .map(record => toOption(record, ['label', 'platform', 'name']))
    },

    async updateClientProfile(clientId: number, input: ClientProfilePatch): Promise<ClientDashboard> {
      const current = await refetchDashboard(clientId)
      const patch = buildChangedClientPatch(current.client, input)
      if (Object.keys(patch).length) {
        await nocoClient.patchRecord(TABLES.clients.id, Number(clientId), patch)
      }
      return await refetchDashboard(clientId)
    },

    async createPlatformAccount(clientId: number, input: PlatformAccountInput): Promise<ClientDashboard> {
      const record = buildAccountPatch(input, { includeBlankSecrets: true })
      if (!record.account_label) record.account_label = String(record.platform || 'Platform account')
      await nocoClient.createRecord(TABLES.platformAccounts.id, {
        ...record,
        clients_id: Number(clientId)
      })
      return await refetchDashboard(clientId)
    },

    async updatePlatformAccount(clientId: number, accountId: number, input: PlatformAccountInput): Promise<ClientDashboard> {
      await getOwnedPlatformAccount(clientId, accountId)
      const patch = buildAccountPatch(input, { includeBlankSecrets: false })
      if (Object.keys(patch).length) {
        await nocoClient.patchRecord(TABLES.platformAccounts.id, Number(accountId), patch)
      }
      return await refetchDashboard(clientId)
    },

    async deletePlatformAccount(clientId: number, accountId: number): Promise<ClientDashboard> {
      await getOwnedPlatformAccount(clientId, accountId)
      await nocoClient.deleteRecord(TABLES.platformAccounts.id, Number(accountId))
      return await refetchDashboard(clientId)
    },

    async getTelegramPlatformAccountsForClient(clientId: number): Promise<WebPlatformAccount[]> {
      const telegramIds = telegramPlatformIds(await fetchPlatforms())
      return (await fetchPlatformAccountsForClient(clientId))
        .filter(account => isTelegramPlatformAccount(account, telegramIds))
        .map(account => toPlatformAccount(account, true, telegramIds))
    },

    async listActiveTelegramSenders() {
      const clients = await fetchClients()
      const telegramIds = telegramPlatformIds(await fetchPlatforms())
      const clientsById = new Map(clients.map(client => [Number(client.Id), toClient(client)]))
      return (await fetchPlatformAccounts())
        .filter(account => isTelegramPlatformAccount(account, telegramIds))
        .map(account => toPlatformAccount(account, true, telegramIds))
        .filter(account => {
          return (
            account.telegramSessionStatus === 'active' &&
            Boolean(account.telegramTdlibDbPath) &&
            Boolean(account.clientId)
          )
        })
        .map(account => {
          const client = clientsById.get(Number(account.clientId))
          return {
            clientId: Number(account.clientId),
            clientName: client?.clientName || `Client ${account.clientId}`,
            market: client?.market,
            stack: client?.primaryStack,
            accountId: account.id,
            accountLabel: account.accountLabel,
            platform: account.platform,
            phone: account.phone || account.foreignNumber || '',
            status: account.telegramSessionStatus || '',
            dbPath: account.telegramTdlibDbPath || ''
          }
        })
    },

    async updateTelegramPlatformAccount(clientId: number, accountId: number, patch: Record<string, unknown>): Promise<WebPlatformAccount> {
      await getOwnedPlatformAccount(clientId, accountId)
      const allowed = new Set([
        'phone',
        'telegram_session_status',
        'telegram_tdlib_db_path',
        'telegram_last_active',
        'telegram_event_log'
      ])
      const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)))
      if (Object.keys(safePatch).length) {
        await nocoClient.patchRecord(TABLES.platformAccounts.id, Number(accountId), safePatch)
      }
      const telegramIds = telegramPlatformIds(await fetchPlatforms())
      return toPlatformAccount(await getOwnedPlatformAccount(clientId, accountId), true, telegramIds)
    },

    async createDolphinProfileBinding(input: {
      clientId: number
      clientName: string
      locale: 'ru' | 'en'
      dolphinProfileId: number
    }): Promise<unknown> {
      const created = await nocoClient.createRecord(TABLES.dolphinProfiles.id, {
        client_name: input.clientName,
        locale: input.locale,
        dolphin_profile_id: input.dolphinProfileId,
        clients_id: Number(input.clientId)
      })
      const profileRecordId = extractCreatedRecordId(created)
      if (profileRecordId) {
        await linkDolphinProfileToClient(profileRecordId, Number(input.clientId))
      }
      return created
    }
  }
}

module.exports = {
  accountClientId,
  accountPlatformId,
  buildLinkedInEmailByClientId,
  createWebConsoleRepository,
  profileClientId,
  profileId,
  profileLocale,
  isLinkedInPlatformAccount,
  isTelegramPlatformAccount,
  LINKEDIN_PLATFORM_ID,
  linkedStatusMatches,
  normalizeId,
  normalizeEmail,
  buildAccountPatch,
  buildChangedClientPatch,
  buildClientPatch,
  buildResumeWorkflowPatch,
  cvProcessingClientId,
  toClient,
  toPlatformAccount,
  telegramPlatformIds,
  toProviderClientRow,
  toResumeWorkflow
}
