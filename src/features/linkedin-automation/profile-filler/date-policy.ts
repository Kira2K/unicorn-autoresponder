import type { ProfileDate, ValidationIssue, JsonObject } from './input-types.ts'

export function matchesDate(actual: string | undefined, expected: ProfileDate | undefined) {
  if (!expected) return true
  const key = expected.month === undefined ? String(expected.year) :
    `${expected.year}-${String(expected.month).padStart(2, '0')}`
  return expected.month === undefined ? actual?.slice(0, 4) === key : actual === key
}

export function validateEntryDates(data: { startDate?: ProfileDate; endDate?: ProfileDate; isCurrent?: boolean },
  before: JsonObject | undefined, path: string, issues: ValidationIssue[]) {
  if (data.isCurrent && (data.endDate || before?.end_date != null)) {
    issues.push({ level: 'fatal', path: `${path}.data.end_date`,
      message: 'The CV says Present, but LinkedIn has an end date. V2 does not document clearing it safely.',
      resolution: 'Mark the entry as current in LinkedIn, then build a fresh Preview.' })
    return false
  }
  const invalid: string[] = []
  if (!before && !data.startDate?.month) invalid.push('start_date')
  for (const [field, value] of [['start_date', data.startDate], ['end_date', data.endDate]] as const) {
    if (value && value.month === undefined &&
      !matchesDate(typeof before?.[field] === 'string' ? before[field] as string : undefined, value)) {
      if (!invalid.includes(field)) invalid.push(field)
    }
  }
  for (const field of invalid) issues.push({ level: 'fatal', path: `${path}.data.${field}`,
    message: `Unipile requires a month to write ${field}; the CV does not supply it.`,
    resolution: 'Confirm the missing date in the source CV; no month will be invented.' })
  return invalid.length === 0
}
