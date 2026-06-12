const { createNocoClient } = require('../../../../noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../../../noco/core/schema.ts') as {
  TABLES: Record<string, { key: string; id: string; title: string }>
}

type AppDb = import('../types.ts').AppDb
type AutomationTargetOptions = import('../types.ts').AutomationTargetOptions
type ClientAutomationData = import('../types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('../types.ts').ClientHHAuthCredentials
type Market = import('../types.ts').Market
type NocoRecord = Record<string, unknown> & { Id: number }

const STACK_OVERRIDE_FIELD = 'Stack Override'

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
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

function isEnabled(value: unknown): boolean {
  return ['1', 'true', 'yes', 'да', 'y'].includes(normalizeText(value))
}

function linkedId(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const record = Array.isArray(value) ? value[0] : value
  const id = Number((record as Record<string, unknown>)?.Id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function linkedRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  return Array.isArray(value)
    ? (value as Array<Record<string, unknown>>)
    : [value as Record<string, unknown>]
}

function linkedName(value: unknown): string {
  const record = linkedRecords(value)[0]
  return String(
    record?.name ??
      record?.stack ??
      ''
  ).trim()
}

function resolveStack(row: NocoRecord, client: NocoRecord, clientName: string, stacks: NocoRecord[]): string {
  const overrideStacks = linkedRecords(row[STACK_OVERRIDE_FIELD])
  if (overrideStacks.length > 1) {
    throw new Error(
      `Noco Stack Override for "${clientName}" is ambiguous. Matching stack ids: ${overrideStacks
        .map(stack => stack.Id ?? stack.id)
        .join(', ')}`
    )
  }

  const overrideStackId = linkedId(overrideStacks[0])
  const overrideStack = overrideStackId
    ? stacks.find(stack => stack.Id === overrideStackId)
    : undefined

  return linkedName(overrideStacks[0]) || linkedName(overrideStack) || linkedName(client.rel_clients_primary_stack)
}

function normalizeMarket(value: unknown): Market | '' {
  const normalized = normalizeText(value)
  if (normalized === 'ru' || normalized === 'ру') return 'Ru'
  if (normalized === 'en' || normalized === 'eng') return 'En'
  return ''
}

function responseField(market: Market): string {
  return market === 'Ru' ? 'Делаем_отклики_Ru' : 'Делаем_отклики_En'
}

function coverField(market: Market): string {
  return market === 'Ru' ? 'Сопровод_Ru' : 'Сопровод_En'
}

function scenarioLookupStack(clientName: string, stack: string): string {
  if (normalizeText(stack) === 'frontend') {
    return normalizeText(clientName) === 'кира' ? 'КИРА' : 'React'
  }

  return stack
}

function hhPlatform(market: Market): string {
  return market === 'Ru' ? 'hh_ru' : 'hh_en'
}

function isHHPlatformForMarket(value: unknown, market: Market): boolean {
  return normalizeText(value).replace(/\s+/g, '_') === hhPlatform(market)
}

function getPlatformClientId(account: NocoRecord): number | null {
  return linkedId(account.rel_platformAccounts_client) ?? Number(account.clients_id)
}

function getProfileClientId(profile: NocoRecord): number | null {
  return linkedId(profile.rel_dolphinProfiles_client) ?? Number(profile.clients_id)
}

function findClientDolphinProfile(
  profiles: NocoRecord[],
  clientId: number,
  clientName: string,
  market: Market
): NocoRecord {
  const matches = profiles.filter(
    profile =>
      getProfileClientId(profile) === clientId &&
      normalizeMarket(profile.locale) === market
  )

  if (!matches.length) {
    throw new Error(`Noco Dolphin ${market} profile for "${clientName}" was not found`)
  }

  if (matches.length > 1) {
    throw new Error(
      `Noco Dolphin ${market} profile for "${clientName}" is ambiguous. Matching profile rows: ${matches
        .map(profile => profile.Id)
        .join(', ')}`
    )
  }

  const dolphinProfileId = normalizeId(matches[0].dolphin_profile_id)
  if (!dolphinProfileId || !Number.isFinite(Number(dolphinProfileId)) || Number(dolphinProfileId) <= 0) {
    throw new Error(
      `Noco Dolphin ${market} profile for "${clientName}" has invalid dolphin_profile_id: ${dolphinProfileId || 'empty'}`
    )
  }

  return matches[0]
}

function toHHAuthCredentials(
  account: NocoRecord,
  client: NocoRecord,
  market: Market
): ClientHHAuthCredentials {
  const phone = normalizeId(account.phone || account.login)
  const password = String(account.password ?? '').trim()
  const email = String(account.email ?? '').trim() || undefined
  const emailPassword = String(account.email_password ?? '').trim() || undefined
  const clientName = String(client.client_name ?? account.client_name ?? '').trim()
  const commonChatId = normalizeId(client.telegram_general_chat_id)

  if (!phone) {
    throw new Error(`Noco HH ${market} credentials for "${clientName}" are missing phone/login`)
  }

  if (!password) {
    throw new Error(`Noco HH ${market} credentials for "${clientName}" are missing password`)
  }

  return {
    clientName,
    commonChatId,
    market,
    phone,
    rawPhone: phone,
    password,
    email,
    emailPassword
  }
}

function findColumnIndexByValue(row: string[], value: string): number {
  const normalized = normalizeText(value)
  return row.findIndex(item => normalizeText(item) === normalized)
}

function scenarioField(market: Market): string {
  return market === 'Ru' ? 'hh_scenario_url_ru' : 'hh_scenario_url_en'
}

function findStackScenario(stacks: NocoRecord[], stack: string, market: Market): string | undefined {
  const normalized = normalizeText(stack)
  const row = stacks.find(item =>
    [item.hh_scenario_alias, item.name, item.slug].some(value => normalizeText(value) === normalized)
  )
  return String(row?.[scenarioField(market)] ?? '').trim() || undefined
}

async function fetchNocoAutomationState(client: any): Promise<{
  clients: NocoRecord[]
  autoresponseRows: NocoRecord[]
  profiles: NocoRecord[]
  stacks: NocoRecord[]
}> {
  const [clients, autoresponseRows, profiles, stacks] = await Promise.all([
    client.fetchRecords(TABLES.clients.id, 1000),
    client.fetchRecords(TABLES.hhAutoresponses.id, 1000),
    client.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    client.fetchRecords(TABLES.stacks.id, 1000)
  ])
  return { clients, autoresponseRows, profiles, stacks }
}

function buildAutomationTargetsFromNocoState(
  state: {
    clients: NocoRecord[]
    autoresponseRows: NocoRecord[]
    profiles: NocoRecord[]
    stacks: NocoRecord[]
  },
  options: AutomationTargetOptions = {}
): ClientAutomationData[] {
  const marketFilter = options.market ?? ((options.workWithRuOnly ?? true) ? 'Ru' : undefined)
  const clientsById = new Map(state.clients.map(client => [client.Id, client]))
  const targets: ClientAutomationData[] = []

  for (const row of state.autoresponseRows) {
    const clientId = linkedId(row.rel_hhAutoresponses_client) ?? Number(row.clients_id)
    const client = clientsById.get(clientId)
    if (!client) continue

    const clientName = String(client.client_name ?? '').trim()
    const stack = resolveStack(row, client, clientName, state.stacks)
    const commonChatId = normalizeId(client.telegram_general_chat_id)
    if (!clientName || !stack || !commonChatId) continue

    for (const market of ['Ru', 'En'] as Market[]) {
      if (marketFilter && market !== marketFilter) continue
      if (!isEnabled(row[responseField(market)])) continue

      const profile = findClientDolphinProfile(
        state.profiles,
        client.Id,
        clientName,
        market
      )
      const dolphinProfileId = Number(normalizeId(profile.dolphin_profile_id))

      const scenario = findStackScenario(
        state.stacks,
        scenarioLookupStack(clientName, stack),
        market
      )

      targets.push({
        clientName,
        stack,
        market,
        dolphinProfileId,
        commonChatId,
        coverText: String(row[coverField(market)] ?? '').trim() || undefined,
        stackSheetName: 'Noco stacks',
        stackScenario: scenario
      })
    }
  }

  return targets
}

async function findNocoClientForAuth(
  nocoClient: any,
  predicate: (client: NocoRecord) => boolean,
  description: string
): Promise<NocoRecord> {
  const clients: NocoRecord[] = await nocoClient.fetchRecords(TABLES.clients.id, 1000)
  const matches = clients.filter(predicate)

  if (!matches.length) {
    throw new Error(`Noco client for ${description} was not found`)
  }

  if (matches.length > 1) {
    throw new Error(
      `Noco client for ${description} is ambiguous. Matching ids: ${matches
        .map(client => client.Id)
        .join(', ')}`
    )
  }

  return matches[0]
}

async function getNocoHHAuthCredentials(
  nocoClient: any,
  client: NocoRecord,
  market: Market
): Promise<ClientHHAuthCredentials> {
  const accounts: NocoRecord[] = await nocoClient.fetchRecords(
    TABLES.platformAccounts.id,
    1000
  )
  const matches = accounts.filter(
    account =>
      getPlatformClientId(account) === client.Id &&
      isHHPlatformForMarket(account.platform, market)
  )

  if (!matches.length) {
    throw new Error(
      `Noco canonical HH ${market} account for "${String(client.client_name ?? '').trim()}" was not found`
    )
  }

  if (matches.length > 1) {
    throw new Error(
      `Noco canonical HH ${market} account for "${String(client.client_name ?? '').trim()}" is ambiguous. Matching account ids: ${matches
        .map(account => account.Id)
        .join(', ')}`
    )
  }

  return toHHAuthCredentials(matches[0], client, market)
}

function createNocoDb(options: { nocoClient?: any } = {}): AppDb {
  const nocoClient = options.nocoClient ?? createNocoClient()
  let cachedClients: Promise<NocoRecord[]> | undefined
  let cachedPlatformAccounts: Promise<NocoRecord[]> | undefined

  function fetchClients(): Promise<NocoRecord[]> {
    const result = cachedClients ?? nocoClient.fetchRecords(TABLES.clients.id, 1000)
    cachedClients = result
    return result
  }

  function fetchPlatformAccounts(): Promise<NocoRecord[]> {
    const result = cachedPlatformAccounts ?? nocoClient.fetchRecords(
      TABLES.platformAccounts.id,
      1000
    )
    cachedPlatformAccounts = result
    return result
  }

  return {
    async getAutomationTargets(mappingOptions: AutomationTargetOptions = {}): Promise<ClientAutomationData[]> {
      return buildAutomationTargetsFromNocoState(
        await fetchNocoAutomationState(nocoClient),
        mappingOptions
      )
    },

    async getAutomationTargetByName(name: string, market: Market = 'Ru'): Promise<ClientAutomationData> {
      const targets = await this.getAutomationTargets({ market })
      const matches = targets.filter(target => target.clientName === name && target.market === market)
      if (!matches.length) throw new Error(`Client "${name}" on market "${market}" was not found or is not enabled`)
      if (matches.length > 1) throw new Error(`Client name "${name}" on market "${market}" is ambiguous. Matching chat ids: ${matches.map(target => target.commonChatId).join(', ')}`)
      return matches[0]
    },

    async getHHAuthCredentialsByClientName(
      name: string,
      market: Market = 'Ru'
    ): Promise<ClientHHAuthCredentials> {
      const client = await findNocoClientForAuth(
        { fetchRecords: fetchClients },
        candidate => String(candidate.client_name ?? '').trim() === name,
        `name "${name}"`
      )

      return getNocoHHAuthCredentials(
        { fetchRecords: fetchPlatformAccounts },
        client,
        market
      )
    },

    async getHHAuthCredentialsByCommonChatId(
      commonChatId: string,
      market: Market = 'Ru'
    ): Promise<ClientHHAuthCredentials> {
      const normalizedChatId = normalizeId(commonChatId)
      const client = await findNocoClientForAuth(
        { fetchRecords: fetchClients },
        candidate => normalizeId(candidate.telegram_general_chat_id) === normalizedChatId,
        `common chat id "${commonChatId}"`
      )

      return getNocoHHAuthCredentials(
        { fetchRecords: fetchPlatformAccounts },
        client,
        market
      )
    },

    async getStudentTelegramRecords() {
      throw new Error('Noco student Telegram records are not implemented yet')
    },

    async getProxyRequiredClients() {
      throw new Error('Noco proxy-required clients are not implemented yet')
    }
  }
}

module.exports = {
  buildAutomationTargetsFromNocoState,
  createNocoDb,
  findClientDolphinProfile,
  findStackScenario,
  getNocoHHAuthCredentials,
  isEnabled,
  normalizeId,
  responseField,
  scenarioLookupStack
}
