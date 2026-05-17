const { SHEET_LABELS } = require('../schema.ts') as {
  SHEET_LABELS: Record<string, string>
}

function normalizeSheetValue(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeSheetKey(value: unknown): string {
  return normalizeSheetValue(value).toLowerCase()
}

function normalizeTelegramUsername(value: unknown): string {
  return normalizeSheetValue(value).replace(/^@+/, '').toLowerCase()
}

function findRowIndexWithValue(values: string[][], value: string): number {
  const normalizedValue = normalizeSheetKey(value)
  const rowIndex = values.findIndex(row =>
    row.some(cell => normalizeSheetKey(cell) === normalizedValue)
  )

  if (rowIndex === -1) {
    throw new Error(`Row with value "${value}" was not found`)
  }

  return rowIndex
}

function findCellIndex(row: string[], value: string): number {
  const normalizedValue = normalizeSheetKey(value)
  return row.findIndex(cell => normalizeSheetKey(cell) === normalizedValue)
}

function findRealDataRowIndex(values: string[][], label: string): number {
  const realDataRowIndex = findRowIndexWithValue(values, SHEET_LABELS.realData)

  for (
    let rowIndex = realDataRowIndex;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row = values[rowIndex] ?? []

    if (
      rowIndex > realDataRowIndex &&
      findCellIndex(row, SHEET_LABELS.realData) !== -1
    ) {
      break
    }

    if (findCellIndex(row, label) !== -1) {
      return rowIndex
    }
  }

  throw new Error(`"${label}" row was not found in "${SHEET_LABELS.realData}" section`)
}

module.exports = {
  findCellIndex,
  findRealDataRowIndex,
  findRowIndexWithValue,
  normalizeSheetKey,
  normalizeSheetValue,
  normalizeTelegramUsername
}
