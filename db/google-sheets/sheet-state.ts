const {
  fetchNamedSheetValues,
  getRequiredSheet
} = require('../../google-sheets-check.ts') as {
  fetchNamedSheetValues(sheetNames: string[]): Promise<SheetState>
  getRequiredSheet(sheets: SheetValues[], expectedTitle: string): string[][]
}
const { SHEET_NAMES } = require('../schema.ts') as {
  SHEET_NAMES: Record<string, string>
}
const { normalizeSheetKey } = require('./sheet-helpers.ts') as {
  normalizeSheetKey(value: unknown): string
}

type SheetState = import('../types.ts').SheetState
type SheetValues = import('../types.ts').SheetValues

type GoogleSheetsDbOptions = {
  sheetState?: SheetState
}

function createInMemorySheetState(values: {
  personalDataValues?: string[][]
  dolphinMainValues?: string[][]
  stacksValues?: string[][]
}): SheetState {
  return {
    spreadsheet: {
      id: 'in-memory',
      name: 'in-memory'
    },
    spreadsheetTitle: 'in-memory',
    sheets: [
      values.personalDataValues && {
        title: SHEET_NAMES.personalData,
        values: values.personalDataValues
      },
      values.dolphinMainValues && {
        title: SHEET_NAMES.dolphinMain,
        values: values.dolphinMainValues
      },
      values.stacksValues && {
        title: SHEET_NAMES.stacks,
        values: values.stacksValues
      }
    ].filter(Boolean) as SheetValues[]
  }
}

function mergeSheetStates(
  current: SheetState | undefined,
  next: SheetState
): SheetState {
  if (!current) {
    return next
  }

  const sheetsByTitle = new Map<string, SheetValues>()

  for (const sheet of current.sheets) {
    sheetsByTitle.set(normalizeSheetKey(sheet.title), sheet)
  }

  for (const sheet of next.sheets) {
    sheetsByTitle.set(normalizeSheetKey(sheet.title), sheet)
  }

  return {
    spreadsheet: next.spreadsheet ?? current.spreadsheet,
    spreadsheetTitle: next.spreadsheetTitle ?? current.spreadsheetTitle,
    sheets: [...sheetsByTitle.values()]
  }
}

function createGoogleSheetsLoader(options: GoogleSheetsDbOptions = {}) {
  let cachedSheetState: SheetState | undefined = options.sheetState

  const hasCachedSheets = (sheetNames: string[]): boolean => {
    if (!cachedSheetState) {
      return false
    }

    const cachedTitles = new Set(
      cachedSheetState.sheets.map(sheet => normalizeSheetKey(sheet.title))
    )

    return sheetNames.every(sheetName =>
      cachedTitles.has(normalizeSheetKey(sheetName))
    )
  }

  const loadSheets = async (sheetNames: string[]): Promise<SheetState> => {
    if (hasCachedSheets(sheetNames)) {
      return cachedSheetState as SheetState
    }

    const nextSheetState = await fetchNamedSheetValues(sheetNames)
    cachedSheetState = mergeSheetStates(cachedSheetState, nextSheetState)

    return cachedSheetState
  }

  const loadPersonalDataValues = async (): Promise<string[][]> => {
    const state = await loadSheets([SHEET_NAMES.personalData])

    return getRequiredSheet(state.sheets, SHEET_NAMES.personalData)
  }

  const loadAutomationValues = async (): Promise<{
    personalDataValues: string[][]
    dolphinMainValues: string[][]
    stacksValues: string[][]
  }> => {
    const state = await loadSheets([
      SHEET_NAMES.personalData,
      SHEET_NAMES.dolphinMain,
      SHEET_NAMES.stacks
    ])

    return {
      personalDataValues: getRequiredSheet(state.sheets, SHEET_NAMES.personalData),
      dolphinMainValues: getRequiredSheet(state.sheets, SHEET_NAMES.dolphinMain),
      stacksValues: getRequiredSheet(state.sheets, SHEET_NAMES.stacks)
    }
  }

  return {
    loadAutomationValues,
    loadPersonalDataValues,
    loadSheets
  }
}

module.exports = {
  createGoogleSheetsLoader,
  createInMemorySheetState,
  mergeSheetStates
}
