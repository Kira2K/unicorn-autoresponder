import type { JsonObject, ValidationIssue } from './input-types.ts'

export const record = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function fatal(issues: ValidationIssue[], path: string, message: string) {
  issues.push({ level: 'fatal', path, message,
    resolution: 'Rebuild Preview after fixing the Profile Filler contract.' })
}

export function onlyFields(
  value: JsonObject, allowed: readonly string[], path: string, issues: ValidationIssue[]
) {
  const extra = Object.keys(value).filter(key => !allowed.includes(key))
  extra.forEach(key => fatal(issues, `${path}.${key}`, 'Field is not accepted by Unipile v2.'))
}

export function requiredFields(
  value: JsonObject, required: readonly string[], path: string, issues: ValidationIssue[]
) {
  required.filter(key => value[key] === undefined).forEach(key =>
    fatal(issues, `${path}.${key}`, 'Required Unipile v2 field is missing.'))
}

export function stringField(
  value: unknown, path: string, issues: ValidationIssue[], allowEmpty = false
) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    fatal(issues, path, 'Expected a string accepted by Unipile v2.')
  }
}

export function booleanField(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value !== undefined && typeof value !== 'boolean') {
    fatal(issues, path, 'Expected a boolean accepted by Unipile v2.')
  }
}

export function enumField(
  value: unknown, allowed: readonly string[], path: string, issues: ValidationIssue[]
) {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) {
    fatal(issues, path, 'Value is outside the Unipile v2 enum.')
  }
}

export function named(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!record(value)) { fatal(issues, path, 'Expected an object with name.'); return }
  onlyFields(value, ['name', 'id'], path, issues)
  stringField(value.name, `${path}.name`, issues)
  if (value.id !== undefined) stringField(value.id, `${path}.id`, issues)
}

export function dateField(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!record(value)) { fatal(issues, path, 'Expected { year, month }.'); return }
  onlyFields(value, ['year', 'month'], path, issues)
  const year = Number(value.year)
  const month = Number(value.month)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    fatal(issues, path, 'Expected a valid Unipile year and month.')
  }
}

export function namedList(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) { fatal(issues, path, 'Expected an array.'); return }
  value.forEach((item, index) => named(item, `${path}[${index}]`, issues))
}
