type SheetValues = {
  title: string
  values: string[][]
}

type SheetState = {
  spreadsheetTitle: string
  sheets: SheetValues[]
}

type AutomationTarget = {
  clientName: string
  market: 'Ru' | 'En'
  stack: string
  dolphinProfileId: number
  commonChatId: string
  coverText?: string
  stackScenario?: string
}

const { fetchAllSheetValues, mapAllClientsAutomationData } =
  require('./google-sheets-check.ts') as {
    fetchAllSheetValues(): Promise<SheetState>
    mapAllClientsAutomationData(
      personalDataValues: string[][],
      dolphinMainValues: string[][],
      stacksValues: string[][],
      options?: { workWithRuOnly?: boolean }
    ): AutomationTarget[]
  }

const REQUIRED_SHEETS = {
  personal: 'ПЕРС ДАННЫЕ',
  dolphinMain: 'Dolphin main',
  stacks: 'Стеки'
} as const
const cliArgs = process.argv.slice(2)
const isStrict = cliArgs.includes('--strict')
const showAllMarkets = true
// const showAllMarkets = cliArgs.includes('--all-markets')
const clientNameFilters = cliArgs.filter(arg => !arg.startsWith('--'))

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function getRequiredSheet(sheets: SheetValues[], title: string): SheetValues {
  const sheet = sheets.find(
    item => normalizeKey(item.title) === normalizeKey(title)
  )

  if (!sheet) {
    throw new Error(`Sheet "${title}" was not found`)
  }

  return sheet
}

function getColumnCount(values: string[][]): number {
  return Math.max(0, ...values.map(row => row.length))
}

function formatFlag(value: boolean): string {
  return value ? 'yes' : 'NO'
}

function formatTarget(target: AutomationTarget): string {
  return [
    `${target.clientName} / ${target.market}`,
    target.stack,
    `profile ${target.dolphinProfileId}`,
    `chat ${formatFlag(Boolean(target.commonChatId))}`,
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

function applyClientFilters(targets: AutomationTarget[]): AutomationTarget[] {
  if (!clientNameFilters.length) {
    return targets
  }

  const normalizedFilters = new Set(clientNameFilters.map(normalizeKey))

  return targets.filter(target =>
    normalizedFilters.has(normalizeKey(target.clientName))
  )
}

async function main(): Promise<void> {
  const state = await fetchAllSheetValues()
  const personalData = getRequiredSheet(
    state.sheets,
    REQUIRED_SHEETS.personal
  ).values
  const dolphinMain = getRequiredSheet(
    state.sheets,
    REQUIRED_SHEETS.dolphinMain
  ).values
  const stacks = getRequiredSheet(state.sheets, REQUIRED_SHEETS.stacks).values
  const defaultRuTargets = mapAllClientsAutomationData(
    personalData,
    dolphinMain,
    stacks,
    {
      workWithRuOnly: true
    }
  )
  const allEnabledTargets = mapAllClientsAutomationData(
    personalData,
    dolphinMain,
    stacks,
    {
      workWithRuOnly: false
    }
  )
  const defaultRuTargetsToPrint = applyClientFilters(defaultRuTargets)
  const allEnabledTargetsToPrint = applyClientFilters(allEnabledTargets)
  const warningTargets = showAllMarkets
    ? allEnabledTargetsToPrint
    : defaultRuTargetsToPrint
  const missingScenarioTargets = warningTargets.filter(
    target => !target.stackScenario
  )

  if (clientNameFilters.length) {
    console.log(`Filter: ${clientNameFilters.join(', ')}`)
  }
  console.log(
    `Default market mode: ${showAllMarkets ? 'all markets' : 'Ru only'}`
  )
  console.log('\nSheets:')
  for (const sheet of state.sheets) {
    console.log(
      `  - ${sheet.title}: ${sheet.values.length} rows, ${getColumnCount(sheet.values)} cols`
    )
  }

  printTargets('Default Ru targets (ordinary run)', defaultRuTargetsToPrint)
  if (showAllMarkets) {
    printTargets('All enabled targets (Ru + En)', allEnabledTargetsToPrint)
  }

  if (missingScenarioTargets.length) {
    printTargets(
      'Warnings: enabled targets without scenario URL',
      missingScenarioTargets
    )
    if (isStrict) {
      process.exitCode = 1
    }
  } else {
    console.log('\nWarnings: none')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
