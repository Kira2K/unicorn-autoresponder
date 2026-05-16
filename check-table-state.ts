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

type CliOptions = {
  containsNames: string[]
  exactNames: string[]
  help: boolean
  json: boolean
  strict: boolean
}

type RawDolphinMatch = {
  column: number
  rawName: string
  stack: string
  ruEnabled: string
  enEnabled: string
  ruProfileId: string
  enProfileId: string
  commonChatId: string
}

const cliOptions = parseCliArgs(process.argv.slice(2))
const showAllMarkets = true
// const showAllMarkets = cliOptions.allMarkets

type TargetDiagnostic = {
  clientName: string
  market: 'Ru' | 'En'
  stack: string
  dolphinProfileId: number
  commonChatId: string
  hasCoverText: boolean
  hasStackScenario: boolean
}

function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    containsNames: [],
    exactNames: [],
    help: false,
    json: false,
    strict: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    if (arg === '--strict') {
      options.strict = true
      continue
    }

    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--name') {
      const value = args[index + 1]
      if (value) {
        options.exactNames.push(value)
        index += 1
      }
      continue
    }

    if (arg.startsWith('--name=')) {
      options.exactNames.push(arg.slice('--name='.length))
      continue
    }

    if (arg === '--contains') {
      const value = args[index + 1]
      if (value) {
        options.containsNames.push(value)
        index += 1
      }
      continue
    }

    if (arg.startsWith('--contains=')) {
      options.containsNames.push(arg.slice('--contains='.length))
      continue
    }

    if (!arg.startsWith('--')) {
      options.exactNames.push(arg)
    }
  }

  return options
}

function printHelp(): void {
  console.log(`Usage:
  node check-table-state.ts
  node check-table-state.ts --name "Иван Меркулов"
  node check-table-state.ts --contains "Иван"
  node check-table-state.ts --contains "Иван" --json

Notes:
  Positional names keep the orchestrator's exact-match behavior.
  Use --contains when you only know a short/raw Dolphin name.`)
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

function getClientFilterQueries(options: CliOptions): string[] {
  return [...options.exactNames, ...options.containsNames].filter(Boolean)
}

function hasClientFilters(options: CliOptions): boolean {
  return Boolean(options.exactNames.length || options.containsNames.length)
}

function applyClientFilters(
  targets: AutomationTarget[],
  options: CliOptions
): AutomationTarget[] {
  if (!hasClientFilters(options)) {
    return targets
  }

  const normalizedExactFilters = new Set(options.exactNames.map(normalizeKey))
  const normalizedContainsFilters = options.containsNames.map(normalizeKey)

  return targets.filter(target =>
    normalizedExactFilters.has(normalizeKey(target.clientName)) ||
    normalizedContainsFilters.some(filter =>
      normalizeKey(target.clientName).includes(filter)
    )
  )
}

function getRowValue(
  values: string[][],
  rowName: string,
  columnIndex: number
): string {
  const row = values.find(item => normalizeKey(item[0]) === normalizeKey(rowName))
  return String(row?.[columnIndex] ?? '').trim()
}

function findRawDolphinMatches(
  dolphinMain: string[][],
  options: CliOptions
): RawDolphinMatch[] {
  const filters = getClientFilterQueries(options).map(normalizeKey)

  if (!filters.length) {
    return []
  }

  const exactFilters = new Set(options.exactNames.map(normalizeKey))
  const containsFilters = options.containsNames.map(normalizeKey)
  const nameRow = dolphinMain.find(
    row => normalizeKey(row[0]) === normalizeKey('имя')
  )

  if (!nameRow) {
    return []
  }

  const matches: RawDolphinMatch[] = []

  for (let column = 1; column < nameRow.length; column += 1) {
    const rawName = String(nameRow[column] ?? '').trim()
    const normalizedName = normalizeKey(rawName)
    const isMatch =
      exactFilters.has(normalizedName) ||
      containsFilters.some(filter => normalizedName.includes(filter))

    if (!rawName || !isMatch) {
      continue
    }

    matches.push({
      column,
      rawName,
      stack: getRowValue(dolphinMain, 'СТЕК', column),
      ruEnabled: getRowValue(dolphinMain, 'Делаем отклики Ru', column),
      enEnabled: getRowValue(dolphinMain, 'Делаем отклики En', column),
      ruProfileId: getRowValue(dolphinMain, 'Dolphin Profile Ru Id', column),
      enProfileId: getRowValue(dolphinMain, 'Dolphin Profile En Id', column),
      commonChatId: getRowValue(dolphinMain, 'Id общего чата', column)
    })
  }

  return matches
}

function formatRawDolphinMatch(match: RawDolphinMatch): string {
  return [
    `${match.rawName} / column ${match.column + 1}`,
    `stack ${match.stack || 'NO'}`,
    `Ru ${match.ruEnabled || 'NO'} profile ${match.ruProfileId || 'NO'}`,
    `En ${match.enEnabled || 'NO'} profile ${match.enProfileId || 'NO'}`,
    `chat ${match.commonChatId || 'NO'}`
  ].join(' | ')
}

function printRawDolphinMatches(matches: RawDolphinMatch[]): void {
  if (!matches.length) {
    return
  }

  console.log(`\nRaw Dolphin-name matches: ${matches.length}`)
  for (const match of matches) {
    console.log(`  - ${formatRawDolphinMatch(match)}`)
  }
}

function toTargetDiagnostic(target: AutomationTarget): TargetDiagnostic {
  return {
    clientName: target.clientName,
    market: target.market,
    stack: target.stack,
    dolphinProfileId: target.dolphinProfileId,
    commonChatId: target.commonChatId,
    hasCoverText: Boolean(target.coverText),
    hasStackScenario: Boolean(target.stackScenario)
  }
}

async function fetchAllSheetValuesForOutput(
  options: CliOptions
): Promise<SheetState> {
  if (!options.json) {
    return fetchAllSheetValues()
  }

  const originalLog = console.log
  console.log = () => undefined

  try {
    return await fetchAllSheetValues()
  } finally {
    console.log = originalLog
  }
}

function getExactMissSuggestions(
  allEnabledTargets: AutomationTarget[],
  options: CliOptions
): AutomationTarget[] {
  if (!options.exactNames.length) {
    return []
  }

  const exactNames = new Set(options.exactNames.map(normalizeKey))
  const exactMatches = allEnabledTargets.filter(target =>
    exactNames.has(normalizeKey(target.clientName))
  )

  if (exactMatches.length) {
    return []
  }

  const partialQueries = options.exactNames.map(normalizeKey)
  return allEnabledTargets.filter(target =>
    partialQueries.some(query => normalizeKey(target.clientName).includes(query))
  )
}

async function main(): Promise<void> {
  if (cliOptions.help) {
    printHelp()
    return
  }

  const state = await fetchAllSheetValuesForOutput(cliOptions)
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
  const defaultRuTargetsToPrint = applyClientFilters(defaultRuTargets, cliOptions)
  const allEnabledTargetsToPrint = applyClientFilters(
    allEnabledTargets,
    cliOptions
  )
  const warningTargets = showAllMarkets
    ? allEnabledTargetsToPrint
    : defaultRuTargetsToPrint
  const missingScenarioTargets = warningTargets.filter(
    target => !target.stackScenario
  )
  const rawDolphinMatches = findRawDolphinMatches(dolphinMain, cliOptions)
  const exactMissSuggestions = getExactMissSuggestions(
    allEnabledTargets,
    cliOptions
  )

  if (cliOptions.json) {
    console.log(
      JSON.stringify(
        {
          filters: {
            exactNames: cliOptions.exactNames,
            containsNames: cliOptions.containsNames
          },
          sheets: state.sheets.map(sheet => ({
            title: sheet.title,
            rows: sheet.values.length,
            columns: getColumnCount(sheet.values)
          })),
          defaultRuTargets: defaultRuTargetsToPrint.map(toTargetDiagnostic),
          allEnabledTargets: allEnabledTargetsToPrint.map(toTargetDiagnostic),
          rawDolphinMatches,
          exactMissSuggestions: exactMissSuggestions.map(toTargetDiagnostic),
          missingScenarioTargets: missingScenarioTargets.map(toTargetDiagnostic)
        },
        null,
        2
      )
    )
    if (missingScenarioTargets.length && cliOptions.strict) {
      process.exitCode = 1
    }
    return
  }

  if (hasClientFilters(cliOptions)) {
    console.log(
      `Filter: exact=[${cliOptions.exactNames.join(', ') || 'none'}] contains=[${
        cliOptions.containsNames.join(', ') || 'none'
      }]`
    )
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

  printRawDolphinMatches(rawDolphinMatches)
  printTargets('Default Ru targets (ordinary run)', defaultRuTargetsToPrint)
  if (showAllMarkets) {
    printTargets('All enabled targets (Ru + En)', allEnabledTargetsToPrint)
  }

  if (exactMissSuggestions.length) {
    printTargets(
      'No exact enabled target matched; possible selectable names',
      exactMissSuggestions
    )
    console.log(
      '\nTip: ORCHESTRATOR_CLIENT_NAMES uses the final mapped clientName exactly. Use one of the names above, or rerun with --contains for discovery.'
    )
  }

  if (missingScenarioTargets.length) {
    printTargets(
      'Warnings: enabled targets without scenario URL',
      missingScenarioTargets
    )
    if (cliOptions.strict) {
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
