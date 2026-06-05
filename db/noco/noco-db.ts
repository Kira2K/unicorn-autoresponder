const { createNocoClient } = require('../../noco/core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../../noco/core/schema.ts') as {
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

function linkedName(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = Array.isArray(value) ? value[0] : value
  return String(
    (record as Record<string, unknown>)?.name ??
      (record as Record<string, unknown>)?.stack ??
      ''
  ).trim()
}

function normalizeMarket(value: unknown): Market | '' {
  const normalized = normalizeText(value)
  if (normalized === 'ru' || normalized === 'ру') return 'Ru'
  if (normalized === 'en' || normalized === 'eng') return 'En'
  return ''
}

function profileIdField(market: Market): string {
  return market === 'Ru' ? 'Dolphin_Profile_Ru_Id' : 'Dolphin_Profile_En_Id'
}

function responseField(market: Market): string {
  return market === 'Ru' ? 'Делаем_отклики_Ru' : 'Делаем_отклики_En'
}

function coverField(market: Market): string {
  return market === 'Ru' ? 'Сопровод_Ru' : 'Сопровод_En'
}

function profileRelationField(market: Market): string {
  return market === 'Ru'
    ? 'rel_dolphinMainRaw_dolphin_profile_ru'
    : 'rel_dolphinMainRaw_dolphin_profile_en'
}

function hhAccountRelationField(market: Market): string {
  return market === 'Ru'
    ? 'rel_dolphinMainRaw_hh_account_ru'
    : 'rel_dolphinMainRaw_hh_account_en'
}

function hhAccountRelationFkField(market: Market): string {
  return market === 'Ru' ? 'platform_accounts_id' : 'platform_accounts_id1'
}

function enabledField(market: Market): string {
  return responseField(market)
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
  rawRows: NocoRecord[]
  profiles: NocoRecord[]
  stacks: NocoRecord[]
}> {
  const [clients, rawRows, profiles, stacks] = await Promise.all([
    client.fetchRecords(TABLES.clients.id, 1000),
    client.fetchRecords(TABLES.dolphinMainRaw.id, 1000),
    client.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    client.fetchRecords(TABLES.stacks.id, 1000)
  ])
  return { clients, rawRows, profiles, stacks }
}

function buildAutomationTargetsFromNocoState(
  state: {
    clients: NocoRecord[]
    rawRows: NocoRecord[]
    profiles: NocoRecord[]
    stacks: NocoRecord[]
  },
  options: AutomationTargetOptions = {}
): ClientAutomationData[] {
  const marketFilter = options.market ?? ((options.workWithRuOnly ?? true) ? 'Ru' : undefined)
  const clientsById = new Map(state.clients.map(client => [client.Id, client]))
  const profilesById = new Map(state.profiles.map(profile => [profile.Id, profile]))
  const targets: ClientAutomationData[] = []

  for (const row of state.rawRows) {
    const clientId = linkedId(row.rel_dolphinMainRaw_client) ?? Number(row.clients_id)
    const client = clientsById.get(clientId)
    if (!client) continue

    const clientName = String(client.client_name ?? row['имя'] ?? '').trim()
    const stack = String(row[STACK_OVERRIDE_FIELD] ?? '').trim() || linkedName(client.rel_clients_primary_stack)
    const commonChatId = normalizeId(client.telegram_general_chat_id) || normalizeId(row.Id_общего_чата)
    if (!clientName || !stack || !commonChatId) continue

    for (const market of ['Ru', 'En'] as Market[]) {
      if (marketFilter && market !== marketFilter) continue
      if (!isEnabled(row[responseField(market)])) continue

      const rawProfileId = normalizeId(row[profileIdField(market)])
      const relationProfileId = linkedId(row[profileRelationField(market)])
      const profile = relationProfileId ? profilesById.get(relationProfileId) : undefined
      const dolphinProfileId = Number(rawProfileId || profile?.dolphin_profile_id)
      if (!Number.isFinite(dolphinProfileId)) {
        throw new Error(`${profileIdField(market)} for client "${clientName}" is invalid: ${rawProfileId || 'empty'}`)
      }

      if (profile && normalizeId(profile.dolphin_profile_id) !== String(dolphinProfileId)) {
        throw new Error(`Noco profile relation/id mismatch for ${clientName}/${market}`)
      }

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
  market: Market,
  rawRows: NocoRecord[] = []
): Promise<ClientHHAuthCredentials> {
  const accounts: NocoRecord[] = await nocoClient.fetchRecords(
    TABLES.platformAccounts.id,
    1000
  )
  const accountsById = new Map(accounts.map(account => [account.Id, account]))
  const relatedAccountIds = rawRows
    .filter(
      row =>
        (linkedId(row.rel_dolphinMainRaw_client) ?? Number(row.clients_id)) ===
          client.Id && isEnabled(row[enabledField(market)])
    )
    .map(row => (
      linkedId(row[hhAccountRelationField(market)]) ??
      Number(row[hhAccountRelationFkField(market)])
    ) || null)
    .filter((id): id is number => Boolean(id))
  const relationMatches = [...new Set(relatedAccountIds)]
    .map(id => accountsById.get(id))
    .filter((account): account is NocoRecord => Boolean(account))
  const matches = relationMatches.length
    ? relationMatches
    : accounts.filter(
        account =>
          getPlatformClientId(account) === client.Id &&
          isHHPlatformForMarket(account.platform, market)
      )

  if (!matches.length) {
    throw new Error(
      `Noco HH ${market} credentials for "${String(client.client_name ?? '').trim()}" were not found`
    )
  }

  if (matches.length > 1) {
    throw new Error(
      `Noco HH ${market} credentials for "${String(client.client_name ?? '').trim()}" are ambiguous. Matching account ids: ${matches
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
  let cachedRawRows: Promise<NocoRecord[]> | undefined

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

  function fetchRawRows(): Promise<NocoRecord[]> {
    const result = cachedRawRows ?? nocoClient.fetchRecords(TABLES.dolphinMainRaw.id, 1000)
    cachedRawRows = result
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
        market,
        await fetchRawRows()
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
        market,
        await fetchRawRows()
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
  findStackScenario,
  getNocoHHAuthCredentials,
  isEnabled,
  normalizeId,
  scenarioLookupStack
}
