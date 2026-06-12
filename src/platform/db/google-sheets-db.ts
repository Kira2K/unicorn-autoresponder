const {
  createGoogleSheetsDb
} = require('./google-sheets/google-sheets-db-factory.ts') as {
  createGoogleSheetsDb(options?: GoogleSheetsDbOptions): AppDb
}
const {
  createInMemorySheetState
} = require('./google-sheets/sheet-state.ts') as {
  createInMemorySheetState(values: {
    personalDataValues?: string[][]
    dolphinMainValues?: string[][]
    stacksValues?: string[][]
  }): SheetState
}
const {
  parseStudentTelegramRecords
} = require('./google-sheets/student-telegram-mapper.ts') as {
  parseStudentTelegramRecords(personalDataValues: string[][]): StudentTelegramRecord[]
}

type AppDb = import('./types.ts').AppDb
type SheetState = import('./types.ts').SheetState
type StudentTelegramRecord = import('./types.ts').StudentTelegramRecord

type GoogleSheetsDbOptions = {
  sheetState?: SheetState
}

function createGoogleSheetsDbFromValues(values: {
  personalDataValues?: string[][]
  dolphinMainValues?: string[][]
  stacksValues?: string[][]
}): AppDb {
  return createGoogleSheetsDb({
    sheetState: createInMemorySheetState(values)
  })
}

module.exports = {
  createGoogleSheetsDb,
  createGoogleSheetsDbFromValues,
  createInMemorySheetState,
  parseStudentTelegramRecords
}
