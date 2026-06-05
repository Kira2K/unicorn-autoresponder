const { createNocoDb } = require('../../db/noco/noco-db.ts') as {
  createNocoDb(): import('../../db/types.ts').AppDb
}
const {
  findStackScenario,
  normalizeId,
  scenarioLookupStack
} = require('../../db/noco/noco-db.ts') as {
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
  hasHHAccountRelation: boolean
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

function linkedId(value: unknown): number | null {
  const record = linkedRecord(value)
  const id = Number(record?.Id ?? record?.id)
  return Number.isFinite(id) && id > 0 ? id : null
}

function profileRelationField(market: Market): string {
  return market === 'Ru'
    ? 'rel_dolphinMainRaw_dolphin_profile_ru'
    : 'rel_dolphinMainRaw_dolphin_profile_en'
}

function profileRelationFkField(market: Market): string {
  return market === 'Ru' ? 'dolphin_profiles_id' : 'dolphin_profiles_id1'
}

function profileIdField(market: Market): string {
  return market === 'Ru' ? 'Dolphin_Profile_Ru_Id' : 'Dolphin_Profile_En_Id'
}

function coverField(market: Market): string {
  return market === 'Ru' ? 'Сопровод_Ru' : 'Сопровод_En'
}

function enabledField(market: Market): string {
  return market === 'Ru' ? 'Делаем_отклики_Ru' : 'Делаем_отклики_En'
}

function hhAccountRelationField(market: Market): string {
  return market === 'Ru'
    ? 'rel_dolphinMainRaw_hh_account_ru'
    : 'rel_dolphinMainRaw_hh_account_en'
}

function hhAccountRelationFkField(market: Market): string {
  return market === 'Ru' ? 'platform_accounts_id' : 'platform_accounts_id1'
}

function linkedName(value: unknown): string {
  const record = linkedRecord(value)
  return String(record?.name ?? record?.stack ?? '').trim()
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
  rawRows: Array<Record<string, unknown> & { Id: number }>
  stacks: Array<Record<string, unknown> & { Id: number }>
}, marketFilter?: Market): TargetReadiness[] {
  const clientsById = new Map(state.clients.map(client => [client.Id, client]))
  const profilesById = new Map(state.profiles.map(profile => [profile.Id, profile]))
  const targets: TargetReadiness[] = []

  for (const row of state.rawRows) {
    const clientId = linkedId(row.rel_dolphinMainRaw_client) ?? Number(row.clients_id)
    const client = clientsById.get(clientId)
    const clientName = String(client?.client_name ?? row['имя'] ?? '').trim()
    const stack = String(row[STACK_OVERRIDE_FIELD] ?? '').trim() || linkedName(client?.rel_clients_primary_stack)
    const commonChatId =
      normalizeId(client?.telegram_general_chat_id) || normalizeId(row.Id_общего_чата)

    for (const market of ['Ru', 'En'] as Market[]) {
      if (marketFilter && market !== marketFilter) continue
      if (!isEnabled(row[enabledField(market)])) continue

      const problems: string[] = []
      const rawProfileId = normalizeId(row[profileIdField(market)])
      const relationProfileId =
        (linkedId(row[profileRelationField(market)]) ?? Number(row[profileRelationFkField(market)])) || null
      const profile = relationProfileId ? profilesById.get(relationProfileId) : undefined
      const dolphinProfileId = Number(rawProfileId || profile?.dolphin_profile_id || 0)
      const hasProfileRelation = Boolean(relationProfileId)
      const hasHHAccountRelation = Boolean(
        (linkedId(row[hhAccountRelationField(market)]) ?? Number(row[hhAccountRelationFkField(market)])) || null
      )
      const coverText = String(row[coverField(market)] ?? '').trim()
      const stackScenario = findStackScenario(
        state.stacks,
        scenarioLookupStack(clientName, stack),
        market
      )

      if (!clientName) problems.push('missing client name')
      if (!stack) problems.push('missing stack')
      if (!rawProfileId && !profile?.dolphin_profile_id) problems.push(`missing ${profileIdField(market)}`)
      if (!Number.isFinite(dolphinProfileId) || dolphinProfileId <= 0) problems.push('missing Dolphin profile id')
      if (!commonChatId) problems.push('missing common chat id')
      if (!coverText) problems.push('missing cover text')
      if (!stackScenario) problems.push('missing scenario URL')
      if (!hasProfileRelation) problems.push('missing Dolphin profile relation')
      if (profile && rawProfileId && normalizeId(profile.dolphin_profile_id) !== String(dolphinProfileId)) {
        problems.push('Dolphin profile relation/id mismatch')
      }
      if (!hasHHAccountRelation) problems.push('missing HH account relation')

      targets.push({
        clientName,
        market,
        stack,
        dolphinProfileId: Number.isFinite(dolphinProfileId) ? dolphinProfileId : 0,
        commonChatId,
        hasCoverText: Boolean(coverText),
        hasStackScenario: Boolean(stackScenario),
        hasProfileRelation,
        hasHHAccountRelation,
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
  const [clients, profiles, rawRows, stacks] = await Promise.all([
    nocoClient.fetchRecords(TABLES.clients.id, 1000),
    nocoClient.fetchRecords(TABLES.dolphinProfiles.id, 1000),
    nocoClient.fetchRecords(TABLES.dolphinMainRaw.id, 1000),
    nocoClient.fetchRecords(TABLES.stacks.id, 1000)
  ])
  const targets = buildTargets({ clients, profiles, rawRows, stacks }, options.market)
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
