import type { JsonObject, ValidationIssue } from '../input-types.ts'

export const object = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const textValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (object(value)) return textValue(value.name ?? value.text ?? value.title)
  return ''
}

export function hint(issues: ValidationIssue[], path: string, message: string,
  resolution: string, suggestion?: string, autoFixed = false) {
  issues.push({ level: 'warning', path, message, resolution, suggestion, autoFixed })
}

export function required(issues: ValidationIssue[], path: string, label: string, suggestion: string) {
  issues.push({ level: 'fatal', path, message: `${label} is required.`,
    resolution: `Fill ${path} in Preview.`, suggestion })
}

export function alias(source: JsonObject, canonical: string, alternatives: string[],
  path: string, issues: ValidationIssue[]) {
  const key = [canonical, ...alternatives].find(item => source[item] !== undefined)
  if (!key) return undefined
  if (key !== canonical) hint(issues, `${path}.${key}`, `Recognized alias "${key}".`,
    `Converted to "${canonical}".`, `"${canonical}": ...`, true)
  return source[key]
}

export function list(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value === undefined) return []
  if (Array.isArray(value)) return value
  hint(issues, path, 'Expected an array.', 'Wrapped the value in an array.', '[ ... ]', true)
  return [value]
}

export function names(value: unknown, path: string, issues: ValidationIssue[]) {
  return list(value, path, issues).map(textValue).filter(Boolean)
}

export function dateValue(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value === undefined || value === null || value === '') return undefined
  if (object(value) && Number(value.year) && Number(value.month)) {
    return `${Number(value.year)}-${String(Number(value.month)).padStart(2, '0')}`
  }
  const match = textValue(value).match(/^(\d{4})-(0?[1-9]|1[0-2])(?:-\d{2})?$/)
  if (!match) return value
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}`
  if (normalized !== value) hint(issues, path, 'Recognized a date variant.',
    'Converted to YYYY-MM.', `"${normalized}"`, true)
  return normalized
}
