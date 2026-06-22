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
  return {
    id: Number(record.Id),
    clientName: normalizeText(record.client_name),
    firstName: normalizeText(record.first_name),
    lastName: normalizeText(record.last_name),
    fio: normalizeText(record.fio),
    birthDate: normalizeText(record.birth_date),
    education: normalizeText(record.education),
    calendarEmail: normalizeText(record.calendar_email),
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

function maskSecret(value: unknown, fullAccess: boolean): string | undefined {
  const text = normalizeText(value)
  if (!text) return undefined
  return fullAccess ? text : '***'
}

function toPlatformAccount(record: NocoRecord, fullAccess: boolean): WebPlatformAccount {
  return {
    id: Number(record.Id),
    platform: normalizeText(record.platform || linkedName(record.rel_platformAccounts_platform)),
    platformId: accountPlatformId(record) || undefined,
    accountLabel: normalizeText(record.account_label || record.label || record.platform),
    login: normalizeText(record.login),
    phone: normalizeText(record.phone),
    email: normalizeText(record.email),
    nickname: normalizeText(record.nickname) || undefined,
    linkedInUrl: normalizeText(record.linkedin_url) || undefined,
    foreignNumber: normalizeText(record.foreign_number) || undefined,
    recoveryCodes: normalizeText(record.recovery_codes) || undefined,
    password: maskSecret(record.password, fullAccess),
    emailPassword: maskSecret(record.email_password, fullAccess)
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

function buildClientPatch(input: ClientProfilePatch): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const textFields: Array<[keyof ClientProfilePatch, string]> = [
    ['firstName', 'first_name'],
    ['lastName', 'last_name'],
    ['fio', 'fio'],
    ['birthDate', 'birth_date'],
    ['education', 'education'],
    ['telegramPersonalChatId', 'telegram_personal_chat_id'],
    ['calendarEmail', 'calendar_email']
  ]
  for (const [inputField, nocoField] of textFields) {
    const value = cleanOptionalText(input[inputField])
    if (value !== undefined) patch[nocoField] = value
  }
  const englishLevelId = cleanNullableId(input.englishLevelId)
  if (englishLevelId !== undefined) patch.english_levels_id = englishLevelId
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

  async function fetchClientStatusOptions(): Promise<NocoSelectOption[]> {
    if (typeof nocoClient.fetchTableMeta !== 'function') return []
    const meta = await nocoClient.fetchTableMeta(TABLES.clients.id)
    const statusColumn = (meta.columns ?? []).find((column: any) => column.title === 'client_status')
    return statusColumn?.colOptions?.options ?? []
  }

  async function dashboardForClient(client: NocoRecord, fullAccess = false): Promise<ClientDashboard> {
    const clientPlatformAccounts = (await fetchPlatformAccountsForClient(Number(client.Id)))
      .sort((a, b) => Number(a.Id) - Number(b.Id))
    const linkedInEmailByClientId = buildLinkedInEmailByClientId(clientPlatformAccounts)
    const platformAccounts = clientPlatformAccounts
      .map(account => toPlatformAccount(account, fullAccess))

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
  LINKEDIN_PLATFORM_ID,
  linkedStatusMatches,
  normalizeId,
  normalizeEmail,
  buildAccountPatch,
  buildChangedClientPatch,
  buildClientPatch,
  toClient,
  toPlatformAccount,
  toProviderClientRow
}
