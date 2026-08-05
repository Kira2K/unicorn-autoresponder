const { createNocoDb } = require('../../../platform/db/noco/noco-db.ts') as {
  createNocoDb(): import('../../../platform/db/types.ts').AppDb
}
const {
  findClientDolphinProfile,
  isHHPlatformAccountForMarket,
  normalizeId,
  resolveStack: resolveNocoStack,
  stackScenario
} = require('../../../platform/db/noco/noco-db.ts') as {
  findClientDolphinProfile(
    profiles: Array<Record<string, unknown> & { Id: number }>,
    clientId: number,
    clientName: string,
    market: Market
  ): Record<string, unknown> & { Id: number }
  isHHPlatformAccountForMarket(account: Record<string, unknown> & { Id: number }, market: Market): boolean
  normalizeId(value: unknown): string
  resolveStack(row: Record<string, unknown> & { Id: number }, client: Record<string, unknown> & { Id: number }, clientName: string, stacks: Array<Record<string, unknown> & { Id: number }>): {
    id: number | null
    name: string
    source: 'override' | 'primary'
    row?: Record<string, unknown> & { Id: number }
  }
  stackScenario(stack: { row?: Record<string, unknown> } | Record<string, unknown> | undefined, market: Market): string | undefined
}
const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { key: string; id: string; title: string }>
}

type Market = import('../../../platform/db/types.ts').Market

type CliOptions = {
  clientNames: string[]
  json: boolean
  market?: Market
  strict: boolean
}

type TargetReadiness = {
  clientId: number
  clientName: string
  enabled: boolean
  market: Market
  stack: string
  stackId: number
  stackSource: string
  dolphinProfileId: number
  commonChatId: string
  hasCoverText: boolean
  hasStackScenario: boolean
  hasProfileRelation: boolean
  hasCanonicalHHAccount: boolean
  canonicalHHAccountId: number
  hasHHCredentials: boolean
  problems: string[]
}

function parseArgs(args: string[]): CliOptions {
  const marketArg = args.find(arg => arg.startsWith('--market='))
  const marketValue = marketArg?.slice('--market='.length).trim().toLowerCase()
  const market =
    marketValue === 'ru' ? 'Ru' : marketValue === 'en' ? 'En' : undefined
  const clientNamesArg = args.find(arg => arg.startsWith('--client-names='))
  const clientNames = String(clientNamesArg?.slice('--client-names='.length) ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  return {
    clientNames,
    json: args.includes('--json'),
    market,
    strict: args.includes('--strict')
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\u0451/g, '\u0435')
    .replace(/\s+/g, ' ')
}

function normalizeNameKey(value: unknown): string {
  return normalizeText(value).replace(/\u0451/g, '\u0435')
}

function isEnabled(value: unknown): boolean {
  return ['1', 'true', 'yes', '\u0434\u0430', 'y'].includes(normalizeText(value))
}

function linkedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>
}

function linkedId(value: unknown): number | null {
  const record = linkedRecord(value)
  const id = Number(record?.Id ?? record?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function coverField(market: Market): string {
  return market === 'Ru' ? 'Сопровод_Ru' : 'Сопровод_En'
}

function enabledField(market: Market): string {
  return market === 'Ru' ? 'Делаем_отклики_Ru' : 'Делаем_отклики_En'
}

function platformAccountClientId(account: Record<string, unknown>): number | null {
  return linkedId(account.rel_platformAccounts_client) ?? Number(account.clients_id)
}

function findCanonicalHHAccounts(
  accounts: Array<Record<string, unknown> & { Id: number }>,
  clientId: number,
  market: Market
): Array<Record<string, unknown> & { Id: number }> {
  return accounts.filter(
    account =>
      platformAccountClientId(account) === clientId &&
      isHHPlatformAccountForMarket(account, market)
  )
}

async function checkTarget(
  db: ReturnType<typeof createNocoDb>,
  target: TargetReadiness
): Promise<TargetReadiness> {
  let hasHHCredentials = false
  const problems = [...target.problems]

  if (target.commonChatId) {
    try {
      await db.getHHAuthCredentialsByCommonChatId(
        target.commonChatId,
        target.market
      )
      hasHHCredentials = true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      problems.push(`missing HH credentials: ${message}`)
    }
  } else {
    problems.push('missing HH credentials: missing common chat id')
  }

  return {
    ...target,
    hasHHCredentials,
    problems
  }
}

function buildTargets(state: {
  clients: Array<Record<string, unknown> & { Id: number }>
  profiles: Array<Record<string, unknown> & { Id: number }>
  autoresponseRows: Array<Record<string, unknown> & { Id: number }>
  platformAccounts: Array<Record<string, unknown> & { Id: number }>
  stacks: Array<Record<string, unknown> & { Id: number }>
}, marketFilter?: Market, clientNames: string[] = []): TargetReadiness[] {
  const clientsById = new Map(state.clients.map(client => [client.Id, client]))
  const selectedClientNames = new Set(clientNames.map(normalizeNameKey))
  const hasSelectedClients = selectedClientNames.size > 0
  const targets: TargetReadiness[] = []
  const seenSelectedKeys = new Set<string>()

  for (const row of state.autoresponseRows) {
    const clientId = linkedId(row.rel_hhAutoresponses_client) ?? Number(row.clients_id)
    const client = clientsById.get(clientId)
    const clientName = String(client?.client_name ?? '').trim()
    const commonChatId = normalizeId(client?.telegram_general_chat_id)
    const selected = selectedClientNames.has(normalizeNameKey(clientName))
    if (hasSelectedClients && !selected) continue

    for (const market of ['Ru', 'En'] as Market[]) {
      if (marketFilter && market !== marketFilter) continue
      const enabled = isEnabled(row[enabledField(market)])
      if (!enabled && !selected) continue
      if (selected) seenSelectedKeys.add(`${normalizeNameKey(clientName)}:${market}`)

      const problems: string[] = []
      let stack = ''
      let stackId = 0
      let stackSource = ''
      let scenarioUrl: string | undefined
      if (client) {
        try {
          const resolvedStack = resolveNocoStack(row, client, clientName, state.stacks)
          stack = resolvedStack.name
          stackId = Number(resolvedStack.id ?? 0)
          stackSource = resolvedStack.source
          scenarioUrl = stackScenario(resolvedStack, market)
        } catch (error: unknown) {
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }
      let profile: (Record<string, unknown> & { Id: number }) | undefined
      if (client) {
        try {
          profile = findClientDolphinProfile(
            state.profiles,
            client.Id,
            clientName,
            market
          )
        } catch (error: unknown) {
          problems.push(error instanceof Error ? error.message : String(error))
        }
      }
      const dolphinProfileId = Number(normalizeId(profile?.dolphin_profile_id))
      const hasProfileRelation = Boolean(profile)
      const hhAccounts = client
        ? findCanonicalHHAccounts(state.platformAccounts, client.Id, market)
        : []
      const canonicalHHAccount = hhAccounts.length === 1 ? hhAccounts[0] : undefined
      const canonicalHHAccountId = Number(canonicalHHAccount?.Id ?? 0)
      const coverText = String(row[coverField(market)] ?? '').trim()
      if (!enabled) problems.push(`HH autoresponses disabled for ${market}`)
      if (!clientName) problems.push('missing client name')
      if (!stack) problems.push('missing stack')
      if (!Number.isFinite(dolphinProfileId) || dolphinProfileId <= 0) problems.push('missing Dolphin profile id')
      if (!commonChatId) problems.push('missing common chat id')
      if (!coverText) problems.push('missing cover text')
      if (!scenarioUrl) problems.push('missing scenario URL')
      if (!hasProfileRelation) problems.push('missing canonical Dolphin profile')
      if (!hhAccounts.length) {
        problems.push('missing canonical HH account')
      } else if (hhAccounts.length > 1) {
        problems.push(`ambiguous canonical HH account: ${hhAccounts.map(account => account.Id).join(', ')}`)
      }

      targets.push({
        clientId: Number(client?.Id ?? 0),
        clientName,
        enabled,
        market,
        stack,
        stackId,
        stackSource,
        dolphinProfileId: Number.isFinite(dolphinProfileId) ? dolphinProfileId : 0,
        commonChatId,
        hasCoverText: Boolean(coverText),
        hasStackScenario: Boolean(scenarioUrl),
        hasProfileRelation,
        hasCanonicalHHAccount: Boolean(canonicalHHAccount),
        canonicalHHAccountId,
        hasHHCredentials: false,
        problems
      })
    }
  }

  if (hasSelectedClients) {
    for (const clientName of clientNames) {
      const client = state.clients.find(candidate =>
        normalizeNameKey(candidate.client_name) === normalizeNameKey(clientName)
      )

      for (const market of ['Ru', 'En'] as Market[]) {
        if (marketFilter && market !== marketFilter) continue
        const key = `${normalizeNameKey(clientName)}:${market}`
        if (seenSelectedKeys.has(key)) continue

        targets.push({
          clientId: Number(client?.Id ?? 0),
          clientName,
          enabled: false,
          market,
          stack: '',
          stackId: 0,
          stackSource: '',
          dolphinProfileId: 0,
          commonChatId: normalizeId(client?.telegram_general_chat_id),
          hasCoverText: false,
          hasStackScenario: false,
          hasProfileRelation: false,
          hasCanonicalHHAccount: false,
          canonicalHHAccountId: 0,
          hasHHCredentials: false,
          problems: client
            ? [`missing hh-autoresponses row for ${market}`]
            : ['client not found']
        })
      }
    }
  }

  return targets
}

function printText(results: TargetReadiness[]): void {
  console.log(`Noco HH response targets: ${results.length}`)

  for (const result of results) {
    const status = result.problems.length ? 'BLOCKED' : 'ready'
    const enabledStatus = result.enabled ? 'enabled' : 'disabled'
    console.log(
      [
        `- ${result.clientName} / ${result.market}`,
        enabledStatus,
        `${result.stack || 'missing stack'} (${result.stackSource || 'no source'}${result.stackId ? ` #${result.stackId}` : ''})`,
        `profile ${result.dolphinProfileId}`,
        `chat ${result.commonChatId}`,
        status
      ].join(' | ')
    )

    for (const problem of result.problems) {
      console.log(`  ! ${problem}`)
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const results = await loadReadinessResults(options)
  const blocked = results.filter(result => result.problems.length)

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          targets: results.length,
          ready: results.length - blocked.length,
          blocked: blocked.length,
          results
        },
        null,
        2
      )
    )
  } else {
    printText(results)
  }

  if (options.strict && blocked.length) {
    process.exitCode = 1
  }
}

async function loadReadinessResults(options: {
  market?: Market
  clientNames?: string[]
  db?: ReturnType<typeof createNocoDb>
  nocoClient?: ReturnType<typeof createNocoClient>
} = {}): Promise<TargetReadiness[]> {
  const db = options.db ?? createNocoDb()
  const nocoClient = options.nocoClient ?? createNocoClient()
  const clients = await nocoClient.fetchRecords(TABLES.clients.id, 1000)
  const profiles = await nocoClient.fetchRecords(
    TABLES.dolphinProfiles.id,
    1000
  )
  const autoresponseRows = await nocoClient.fetchRecords(
    TABLES.hhAutoresponses.id,
    1000
  )
  const platformAccounts = await nocoClient.fetchRecords(
    TABLES.platformAccounts.id,
    1000
  )
  const stacks = await nocoClient.fetchRecords(TABLES.stacks.id, 1000)
  const targets = buildTargets(
    { clients, profiles, autoresponseRows, platformAccounts, stacks },
    options.market,
    options.clientNames ?? []
  )

  return await Promise.all(
    targets.map(target => checkTarget(db, target))
  )
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
}

module.exports = {
  buildTargets,
  checkTarget,
  loadReadinessResults,
  parseArgs
}
