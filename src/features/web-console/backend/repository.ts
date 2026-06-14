const { createNocoClient } = require('../../../integrations/noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>
}

type ClientDashboard = import('./types.ts').ClientDashboard
type WebClient = import('./types.ts').WebClient
type WebConsoleRepository = import('./types.ts').WebConsoleRepository
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
  return normalizeText(record?.name ?? record?.stack ?? record?.label)
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
    calendarEmail: normalizeText(record.calendar_email),
    commonChatId: normalizeText(record.telegram_general_chat_id),
    primaryStack: linkedName(record.rel_clients_primary_stack) || undefined,
    market: normalizeText(record.market) || undefined
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
    accountLabel: normalizeText(record.account_label || record.label || record.platform),
    login: normalizeText(record.login),
    phone: normalizeText(record.phone),
    email: normalizeText(record.email),
    password: maskSecret(record.password, fullAccess),
    emailPassword: maskSecret(record.email_password, fullAccess)
  }
}

function sortByIdDesc(a: NocoRecord, b: NocoRecord): number {
  return Number(b.Id) - Number(a.Id)
}

function createWebConsoleRepository(options: { nocoClient?: any } = {}): WebConsoleRepository {
  const nocoClient = options.nocoClient ?? createNocoClient()

  async function fetchClients(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.clients.id, 1000)
  }

  async function fetchPlatformAccounts(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.platformAccounts.id, 1000)
  }

  async function fetchDolphinProfiles(): Promise<NocoRecord[]> {
    return await nocoClient.fetchRecords(TABLES.dolphinProfiles.id, 1000)
  }

  async function fetchClientStatusOptions(): Promise<NocoSelectOption[]> {
    if (typeof nocoClient.fetchTableMeta !== 'function') return []
    const meta = await nocoClient.fetchTableMeta(TABLES.clients.id)
    const statusColumn = (meta.columns ?? []).find((column: any) => column.title === 'client_status')
    return statusColumn?.colOptions?.options ?? []
  }

  async function dashboardForClient(client: NocoRecord, fullAccess = false): Promise<ClientDashboard> {
    const allPlatformAccounts = await fetchPlatformAccounts()
    const clientPlatformAccounts = allPlatformAccounts
      .filter(account => accountClientId(account) === Number(client.Id))
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

    async getDolphinProfileIdsForClient(clientId: number): Promise<number[]> {
      const profiles = await fetchDolphinProfiles()
      return uniqueSortedProfileIds(profiles.filter(profile => profileClientId(profile) === Number(clientId)))
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
  isLinkedInPlatformAccount,
  LINKEDIN_PLATFORM_ID,
  linkedStatusMatches,
  normalizeId,
  normalizeEmail,
  toClient,
  toPlatformAccount,
  toProviderClientRow
}
