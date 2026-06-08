const { createNocoDb } = require('../../db/noco/noco-db.ts') as {
  createNocoDb(): import('../../db/types.ts').AppDb
}
const {
  findClientDolphinProfile,
  findStackScenario,
  normalizeId,
  scenarioLookupStack
} = require('../../db/noco/noco-db.ts') as {
  findClientDolphinProfile(
    profiles: Array<Record<string, unknown> & { Id: number }>,
    clientId: number,
    clientName: string,
    market: Market
  ): Record<string, unknown> & { Id: number }
  findStackScenario(stacks: Array<Record<string, unknown>>, stack: string, market: Market): string | undefined
  normalizeId(value: unknown): string
  scenarioLookupStack(clientName: string, stack: string): string
}
const { createNocoClient } = require('../core/client.ts') as {
  createNocoClient(options?: any): any
}
const { TABLES } = require('../core/schema.ts') as {
  TABLES: Record<string, { key: string; id: string; title: string }>
}

type Market = import('../../db/types.ts').Market

const STACK_OVERRIDE_FIELD = 'Stack Override'

type CliOptions = {
  json: boolean
  market?: Market
  strict: boolean
}

type TargetReadiness = {
  clientName: string
  market: Market
  stack: string
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

  return {
    json: args.includes('--json'),
    market,
    strict: args.includes('--strict')
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
}

function isEnabled(value: unknown): boolean {
  return ['1', 'true', 'yes', 'да', 'y'].includes(normalizeText(value))
}

function linkedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>
}

function linkedRecords(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return []
  return Array.isArray(value)
    ? (value as Array<Record<string, unknown>>)
    : [value as Record<string, unknown>]
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

function linkedName(value: unknown): string {
  const record = linkedRecord(value)
  return String(record?.name ?? record?.stack ?? '').trim()
}

function resolveStack(
  row: Record<string, unknown>,
  client: Record<string, unknown> | undefined,
  clientName: string,
  stacks: Array<Record<string, unknown> & { Id: number }>,
  problems: string[]
): string {
  const overrideStacks = linkedRecords(row[STACK_OVERRIDE_FIELD])
  if (overrideStacks.length > 1) {
    problems.push(
      `ambiguous stack override: ${overrideStacks
        .map(stack => stack.Id ?? stack.id)
        .join(', ')}`
    )
    return ''
  }

  const overrideStackId = linkedId(overrideStacks[0])
  const overrideStack = overrideStackId
    ? stacks.find(stack => stack.Id === overrideStackId)
    : undefined

  return linkedName(overrideStacks[0]) || linkedName(overrideStack) || linkedName(client?.rel_clients_primary_stack)
}

function hhPlatform(market: Market): string {
  return market === 'Ru' ? 'hh_ru' : 'hh_en'
}

function isHHPlatformForMarket(value: unknown, market: Market): boolean {
  return normalizeText(value).replace(/\s+/g, '_') === hhPlatform(market)
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
      isHHPlatformForMarket(account.platform, market)
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
}, marketFilter?: Market): TargetReadiness[] {
  const clientsById = new Map(state.clients.map(client => [client.Id, client]))
  const targets: TargetReadiness[] = []

  for (const row of state.autoresponseRows) {
    const clientId = linkedId(row.rel_hhAutoresponses_client) ?? Number(row.clients_id)
    const client = clientsById.get(clientId)
    const clientName = String(client?.client_name ?? '').trim()
    const commonChatId = normalizeId(client?.telegram_general_chat_id)

    for (const market of ['Ru', 'En'] as Market[]) {
      if (marketFilter && market !== marketFilter) continue
      if (!isEnabled(row[enabledField(market)])) continue

      const problems: string[] = []
      const stack = resolveStack(row, client, clientName, state.stacks, problems)
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
      const stackScenario = findStackScenario(
        state.stacks,
        scenarioLookupStack(clientName, stack),
        market
      )

      if (!clientName) problems.push('missing client name')
      if (!stack) problems.push('missing stack')
      if (!Number.isFinite(dolphinProfileId) || dolphinProfileId <= 0) problems.push('missing Dolphin profile id')
      if (!commonChatId) problems.push('missing common chat id')
      if (!coverText) problems.push('missing cover text')
      if (!stackScenario) problems.push('missing scenario URL')
      if (!hasProfileRelation) problems.push('missing canonical Dolphin profile')
      if (!hhAccounts.length) {
        problems.push('missing canonical HH account')
      } else if (hhAccounts.length > 1) {
        problems.push(`ambiguous canonical HH account: ${hhAccounts.map(account => account.Id).join(', ')}`)
      }

      targets.push({
        clientName,
        market,
        stack,
        dolphinProfileId: Number.isFinite(dolphinProfileId) ? dolphinProfileId : 0,
        commonChatId,
        hasCoverText: Boolean(coverText),
        hasStackScenario: Boolean(stackScenario),
        hasProfileRelation,
        hasCanonicalHHAccount: Boolean(canonicalHHAccount),
        canonicalHHAccountId,
        hasHHCredentials: false,
        problems
      })
    }
  }

  return targets
}

function printText(results: TargetReadiness[]): void {
  console.log(`Noco HH response targets: ${results.length}`)

  for (const result of results) {
    const status = result.problems.length ? 'BLOCKED' : 'ready'
    console.log(
      [
        `- ${result.clientName} / ${result.market}`,
        result.stack,
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
  const db = createNocoDb()
  const nocoClient = createNocoClient()
  const [clients, profiles, autoresponseRows, platformAccounts, stacks] = await Promise.all([
    nocoClient.fetchRecords(TABLES.clients.id, 1000),
    nocoClient.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    nocoClient.fetchRecords(TABLES.hhAutoresponses.id, 1000),
    nocoClient.fetchRecords(TABLES.platformAccounts.id, 1000),
    nocoClient.fetchRecords(TABLES.stacks.id, 1000)
  ])
  const targets = buildTargets({ clients, profiles, autoresponseRows, platformAccounts, stacks }, options.market)
  const results = await Promise.all(
    targets.map(target => checkTarget(db, target))
  )
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
