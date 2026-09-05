import type { JsonObject, ValidationIssue, YearMonth } from '../input-types.ts'

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function warning(
  issues: ValidationIssue[], path: string, message: string, resolution = 'Поле пропущено.'
) {
  issues.push({ level: 'warning', path, message, resolution })
}

export function yearMonth(value: unknown, path: string, issues: ValidationIssue[]) {
  if (isObject(value)) {
    const year = Number(value.year)
    const month = Number(value.month)
    if (Number.isInteger(year) && year >= 1900 && year <= 2200 && value.month === undefined) {
      return { year }
    }
    if (Number.isInteger(year) && year >= 1900 && year <= 2200 &&
        Number.isInteger(month) && month >= 1 && month <= 12) return { year, month }
  }
  const match = text(value)?.match(/^((?:19|20|21)\d{2})(?:-(0[1-9]|1[0-2]))?$/)
  if (match) return { year: Number(match[1]), ...(match[2] ? { month: Number(match[2]) } : {}) }
  if (value !== undefined) warning(issues, path, 'Ожидалась дата YYYY-MM или {year, month}.')
  return undefined
}

export function strings(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value === undefined) return []
  if (!Array.isArray(value)) { warning(issues, path, 'Ожидался массив строк.'); return [] }
  const result: string[] = []
  const seen = new Set<string>()
  value.forEach((item, index) => {
    const normalized = text(item)
    if (!normalized) { warning(issues, `${path}[${index}]`, 'Ожидалась непустая строка.'); return }
    const key = normalized.toLowerCase()
    if (!seen.has(key)) { seen.add(key); result.push(normalized) }
  })
  return result
}

export function optionalDate(value: unknown, path: string, issues: ValidationIssue[]): YearMonth | undefined {
  return value === undefined ? undefined : yearMonth(value, path, issues)
}
