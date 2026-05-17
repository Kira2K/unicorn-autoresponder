const { SHEET_LABELS } = require('../schema.ts') as {
  SHEET_LABELS: Record<string, string>
}
const {
  findRealDataRowIndex,
  findRowIndexWithValue,
  normalizeSheetKey,
  normalizeSheetValue,
  normalizeTelegramUsername
} = require('./sheet-helpers.ts') as {
  findRealDataRowIndex(values: string[][], label: string): number
  findRowIndexWithValue(values: string[][], value: string): number
  normalizeSheetKey(value: unknown): string
  normalizeSheetValue(value: unknown): string
  normalizeTelegramUsername(value: unknown): string
}

type StudentTelegramRecord = import('../types.ts').StudentTelegramRecord

function parseStudentTelegramRecords(
  personalDataValues: string[][]
): StudentTelegramRecord[] {
  const nameRowIndex = findRowIndexWithValue(
    personalDataValues,
    SHEET_LABELS.name
  )
  const marketRowIndex = findRowIndexWithValue(
    personalDataValues,
    SHEET_LABELS.market
  )
  const fullNameRowIndex = findRealDataRowIndex(
    personalDataValues,
    SHEET_LABELS.fullName
  )
  const telegramRowIndex = findRealDataRowIndex(
    personalDataValues,
    SHEET_LABELS.telegram
  )
  const commonChatIdRowIndex = findRowIndexWithValue(
    personalDataValues,
    SHEET_LABELS.commonChatId
  )
  const nameRow = personalDataValues[nameRowIndex] ?? []
  const marketRow = personalDataValues[marketRowIndex] ?? []
  const fullNameRow = personalDataValues[fullNameRowIndex] ?? []
  const telegramRow = personalDataValues[telegramRowIndex] ?? []
  const commonChatIdRow = personalDataValues[commonChatIdRowIndex] ?? []
  const records: StudentTelegramRecord[] = []

  for (let columnIndex = 0; columnIndex < telegramRow.length; columnIndex += 1) {
    const telegram = normalizeSheetValue(telegramRow[columnIndex])
    const normalizedTelegram = normalizeTelegramUsername(telegram)

    if (
      !normalizedTelegram ||
      normalizeSheetKey(telegram) === normalizeSheetKey(SHEET_LABELS.telegram)
    ) {
      continue
    }

    records.push({
      commonChatId: normalizeSheetValue(commonChatIdRow[columnIndex]),
      market: normalizeSheetValue(marketRow[columnIndex]),
      name:
        normalizeSheetValue(fullNameRow[columnIndex]) ||
        normalizeSheetValue(nameRow[columnIndex]) ||
        'n/a',
      telegram,
      normalizedTelegram
    })
  }

  return records
}

module.exports = {
  parseStudentTelegramRecords
}
