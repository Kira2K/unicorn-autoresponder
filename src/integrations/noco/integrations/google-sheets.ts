const {
  fetchNamedSheetValues,
  getRequiredSheet
} = require('../../../../google-sheets-check.ts') as {
  fetchNamedSheetValues(sheetNames: string[]): Promise<{
    spreadsheetTitle?: string
    sheets: Array<{ title: string; values: string[][] }>
  }>
  getRequiredSheet(
    sheets: Array<{ title: string; values: string[][] }>,
    expectedTitle: string
  ): string[][]
}

async function fetchSheetValues(sheetNames: string[]): Promise<{
  spreadsheetTitle?: string
  sheets: Array<{ title: string; values: string[][] }>
}> {
  return fetchNamedSheetValues(sheetNames)
}

async function fetchRequiredSheet(sheetName: string): Promise<string[][]> {
  const sheetState = await fetchNamedSheetValues([sheetName])
  return getRequiredSheet(sheetState.sheets, sheetName)
}

async function fetchPersonalDataSheet(): Promise<string[][]> {
  return fetchRequiredSheet('ПЕРС ДАННЫЕ')
}

module.exports = {
  fetchPersonalDataSheet,
  fetchRequiredSheet,
  fetchSheetValues,
  getRequiredSheet
}
