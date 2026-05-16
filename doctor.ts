type AutomationTarget = {
  clientName: string
  market: 'Ru' | 'En'
  stack: string
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
  stackScenario?: string
}

type SheetValues = {
  title: string
  values: string[][]
}

type SheetState = {
  spreadsheetTitle: string
  sheets: SheetValues[]
}

const {
  DOLPHIN_MAIN_SHEET_NAME,
  PERSONAL_DATA_SHEET_NAME,
  STACKS_SHEET_NAME,
  fetchAllSheetValues,
  mapAllClientsAutomationData
} = require('./google-sheets-check.ts') as {
  DOLPHIN_MAIN_SHEET_NAME: string
  PERSONAL_DATA_SHEET_NAME: string
  STACKS_SHEET_NAME: string
  fetchAllSheetValues(): Promise<SheetState>
  mapAllClientsAutomationData(
    personalDataValues: string[][],
    dolphinMainValues: string[][],
    stacksValues: string[][],
    options?: { workWithRuOnly?: boolean }
  ): AutomationTarget[]
}
const { parseMarketEnv } = require('./orchestrator/config.ts') as {
  parseMarketEnv(value: string | undefined): 'Ru' | 'En'
}
const {
  getConfiguredClientIds,
  getConfiguredClientNames
} = require('./orchestrator/clients.ts') as {
  getConfiguredClientIds(): string[]
  getConfiguredClientNames(): string[]
}

type DoctorOptions = {
  client?: string
  env: boolean
  help: boolean
}

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function getRequiredSheetValues(
  sheets: SheetValues[],
  title: string
): string[][] {
  const sheet = sheets.find(item => normalizeKey(item.title) === normalizeKey(title))

  if (!sheet) {
    throw new Error(`Sheet "${title}" was not found`)
  }

  return sheet.values
}

function parseArgs(args: string[]): DoctorOptions {
  const options: DoctorOptions = {
    env: false,
    help: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--env') {
      options.env = true
      continue
    }

    if (arg === '--client') {
      options.client = args[index + 1]
      index += 1
      continue
    }

    if (arg.startsWith('--client=')) {
      options.client = arg.slice('--client='.length)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`Usage:
  node doctor.ts --env
  node doctor.ts --client "Иван"

Doctor is diagnostic-only. It does not start Dolphin profiles or change sheet data.`)
}

function printEnv(): void {
  const marketValue = process.env.ORCHESTRATOR_WORK_WITH_MARKET
  let parsedMarket = ''

  try {
    parsedMarket = parseMarketEnv(marketValue)
  } catch (error) {
    parsedMarket = error instanceof Error ? error.message : String(error)
  }

  console.log('Environment:')
  console.log(`  ORCHESTRATOR_CLIENT_NAMES: ${process.env.ORCHESTRATOR_CLIENT_NAMES ?? ''}`)
  console.log(`  parsed client names: ${getConfiguredClientNames().join(', ') || 'none'}`)
  console.log(`  ORCHESTRATOR_CLIENT_IDS: ${process.env.ORCHESTRATOR_CLIENT_IDS ?? ''}`)
  console.log(`  parsed client ids: ${getConfiguredClientIds().join(', ') || 'none'}`)
  console.log(`  ORCHESTRATOR_WORK_WITH_MARKET: ${marketValue ?? ''}`)
  console.log(`  parsed market: ${parsedMarket}`)
  console.log(`  ORCHESTRATOR_WATCH_MS: ${process.env.ORCHESTRATOR_WATCH_MS ?? ''}`)
  console.log(`  ORCHESTRATOR_START_DELAY_MS: ${process.env.ORCHESTRATOR_START_DELAY_MS ?? ''}`)
  console.log(`  DOLPHIN_HEADLESS: ${process.env.DOLPHIN_HEADLESS ?? ''}`)
  console.log(`  HH_AUTH_DEBUG: ${process.env.HH_AUTH_DEBUG ?? ''}`)
}

function formatFlag(value: boolean): string {
  return value ? 'yes' : 'NO'
}

function formatTarget(target: AutomationTarget): string {
  return [
    `${target.clientName} / ${target.market}`,
    target.stack,
    `profile ${target.dolphinProfileId}`,
    `chat ${target.commonChatId || 'NO'}`,
    `cover ${formatFlag(Boolean(target.coverText))}`,
    `scenario ${formatFlag(Boolean(target.stackScenario))}`
  ].join(' | ')
}

function printTargets(title: string, targets: AutomationTarget[]): void {
  console.log(`\n${title}: ${targets.length}`)

  if (!targets.length) {
    console.log('  none')
    return
  }

  for (const target of targets) {
    console.log(`  - ${formatTarget(target)}`)
  }
}

async function loadAllTargets(): Promise<AutomationTarget[]> {
  const state = await fetchAllSheetValues()
  const personalData = getRequiredSheetValues(
    state.sheets,
    PERSONAL_DATA_SHEET_NAME
  )
  const dolphinMain = getRequiredSheetValues(
    state.sheets,
    DOLPHIN_MAIN_SHEET_NAME
  )
  const stacks = getRequiredSheetValues(state.sheets, STACKS_SHEET_NAME)

  return mapAllClientsAutomationData(personalData, dolphinMain, stacks, {
    workWithRuOnly: false
  })
}

async function printClientDiagnostics(clientQuery: string): Promise<void> {
  const normalizedQuery = normalizeKey(clientQuery)
  const targets = await loadAllTargets()
  const exactMatches = targets.filter(
    target => normalizeKey(target.clientName) === normalizedQuery
  )
  const containsMatches = targets.filter(target =>
    normalizeKey(target.clientName).includes(normalizedQuery)
  )

  console.log(`Client query: ${clientQuery}`)
  printTargets('Exact orchestrator-selectable matches', exactMatches)

  if (!exactMatches.length && containsMatches.length) {
    printTargets('Contains matches', containsMatches)
    console.log(
      '\nUse the exact clientName above in ORCHESTRATOR_CLIENT_NAMES, or select by ORCHESTRATOR_CLIENT_IDS/commonChatId.'
    )
  }

  if (!exactMatches.length && !containsMatches.length) {
    console.log('\nNo mapped enabled targets matched this query.')
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || (!options.env && !options.client)) {
    printHelp()
    return
  }

  if (options.env) {
    printEnv()
  }

  if (options.client) {
    await printClientDiagnostics(options.client)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
