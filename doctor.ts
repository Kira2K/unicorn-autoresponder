type AutomationTarget = {
  clientName: string
  market: 'Ru' | 'En'
  stack: string
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
  stackScenario?: string
}

type AppDb = import('./db/types.ts').AppDb
type ClientAutomationData = import('./db/types.ts').ClientAutomationData
type ClientHHAuthCredentials = import('./db/types.ts').ClientHHAuthCredentials

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
const { createAppDb } = require('./db/index.ts') as {
  createAppDb(): AppDb
}
const { assertDolphinAppRunning } = require('./dolphin/index.ts') as {
  assertDolphinAppRunning(): Promise<void>
}

type DoctorOptions = {
  authPreflight: boolean
  client?: string
  env: boolean
  help: boolean
  stopBeforeHh: boolean
}

type AuthPreflightDependencies = {
  assertDolphinAppRunning(): Promise<void>
  createAppDb(): AppDb
  log(message: string): void
}

const DEFAULT_AUTH_PREFLIGHT_CLIENT = '\u041a\u0438\u0440\u0430'

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
    authPreflight: false,
    env: false,
    help: false,
    stopBeforeHh: false
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

    if (arg === '--auth-preflight') {
      options.authPreflight = true
      continue
    }

    if (arg === '--stop-before-hh') {
      options.stopBeforeHh = true
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
  node doctor.ts --auth-preflight --client "Кира" --stop-before-hh
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

function requireNonEmptyField(
  target: ClientAutomationData,
  fieldName: keyof Pick<
    ClientAutomationData,
    'clientName' | 'market' | 'stack' | 'commonChatId' | 'stackScenario'
  >
): void {
  if (!String(target[fieldName] ?? '').trim()) {
    throw new Error(`Auth preflight target is missing ${fieldName}`)
  }
}

function assertTargetReadyForAuthPreflight(target: ClientAutomationData): void {
  requireNonEmptyField(target, 'clientName')
  requireNonEmptyField(target, 'market')
  requireNonEmptyField(target, 'stack')
  requireNonEmptyField(target, 'commonChatId')
  requireNonEmptyField(target, 'stackScenario')

  if (!Number.isFinite(target.dolphinProfileId) || target.dolphinProfileId <= 0) {
    throw new Error(
      `Auth preflight target has invalid Dolphin profile id: ${String(target.dolphinProfileId)}`
    )
  }
}

function assertCredentialsRecordPresent(
  credentials: ClientHHAuthCredentials
): void {
  if (!String(credentials.email ?? '').trim()) {
    throw new Error('Auth preflight HH credentials record is missing email')
  }

  if (!String(credentials.password ?? '').trim()) {
    throw new Error('Auth preflight HH credentials record is missing password')
  }
}

function assertDolphinCloudTokenPresent(): void {
  if (!String(process.env.dolphin_api_token ?? '').trim()) {
    throw new Error('Missing required environment variable: dolphin_api_token')
  }
}

async function runAuthPreflight(
  options: DoctorOptions,
  dependencies: AuthPreflightDependencies = {
    assertDolphinAppRunning,
    createAppDb,
    log: console.log
  }
): Promise<void> {
  if (!options.stopBeforeHh) {
    throw new Error(
      'Auth preflight currently requires --stop-before-hh so no live HH checks are run'
    )
  }

  const clientName = options.client || DEFAULT_AUTH_PREFLIGHT_CLIENT
  const db = dependencies.createAppDb()
  const targets = await db.getAutomationTargets({
    market: parseMarketEnv(process.env.ORCHESTRATOR_WORK_WITH_MARKET)
  })
  const matches = targets.filter(target => target.clientName === clientName)

  if (!matches.length) {
    throw new Error(`Auth preflight client was not found or is not enabled: ${clientName}`)
  }

  if (matches.length > 1) {
    throw new Error(
      `Auth preflight client "${clientName}" is ambiguous. Matching chat ids: ${matches
        .map(target => target.commonChatId)
        .join(', ')}`
    )
  }

  const target = matches[0]
  assertTargetReadyForAuthPreflight(target)

  const credentials = await db.getHHAuthCredentialsByCommonChatId(
    target.commonChatId,
    target.market
  )
  assertCredentialsRecordPresent(credentials)
  assertDolphinCloudTokenPresent()

  await dependencies.assertDolphinAppRunning()

  dependencies.log('Auth preflight passed before HH live checks:')
  dependencies.log(
    `  client: ${target.clientName} / ${target.market} / ${target.stack}`
  )
  dependencies.log(`  common chat id: ${target.commonChatId}`)
  dependencies.log(`  Dolphin profile id: ${target.dolphinProfileId}`)
  dependencies.log(`  scenario URL: ${target.stackScenario}`)
  dependencies.log('  HH credentials record: present')
  dependencies.log(
    '  Dolphin cloud token: present; cloud client uses Authorization: Bearer <dolphin_api_token>'
  )
  dependencies.log('  Dolphin local API: healthy desktop session')
  dependencies.log('  HH live checks: skipped by --stop-before-hh')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  if (options.help || (!options.env && !options.client && !options.authPreflight)) {
    printHelp()
    return
  }

  if (options.env) {
    printEnv()
  }

  if (options.client && !options.authPreflight) {
    await printClientDiagnostics(options.client)
  }

  if (options.authPreflight) {
    await runAuthPreflight(options)
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_AUTH_PREFLIGHT_CLIENT,
  assertCredentialsRecordPresent,
  assertDolphinCloudTokenPresent,
  assertTargetReadyForAuthPreflight,
  main,
  parseArgs,
  runAuthPreflight
}
