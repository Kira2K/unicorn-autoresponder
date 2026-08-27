import type { JsonObject, ValidationIssue } from '../input-types.ts'
import { ENTRY_FIELDS } from '../mcp-contract.ts'
import { alias, dateValue, hint, list, names, object, required, textValue } from './shared.ts'

function normalizedData(source: JsonObject, kind: keyof typeof ENTRY_FIELDS, path: string,
  issues: ValidationIssue[]) {
  const result: JsonObject = {}
  const accepted = new Set(['start_date', 'startDate', 'start', 'end_date', 'endDate', 'end',
    'skills', 'technologies'])
  for (const [key, alternatives] of Object.entries(ENTRY_FIELDS[kind])) {
    accepted.add(key)
    alternatives.forEach((item: string) => accepted.add(item))
    const value = alias(source, key, [...alternatives], path, issues)
    if (value !== undefined) result[key] = textValue(value)
  }
  Object.keys(source).filter(key => !accepted.has(key)).forEach(key => {
    const disabledType = kind === 'experience' &&
      ['employment_type', 'employmentType', 'job_type'].includes(key)
    hint(issues, `${path}.${key}`,
      disabledType ? 'Experience employment_type is temporarily disabled.' :
        'Unsupported field was ignored.',
      disabledType ? 'Remove it from JSON. Open to Work employment_types remains supported.' :
        'Only fields supported by Profile Filler are kept.', undefined, true)
  })
  result.start_date = dateValue(alias(source, 'start_date', ['startDate', 'start'], path, issues),
    `${path}.start_date`, issues)
  result.end_date = dateValue(alias(source, 'end_date', ['endDate', 'end'], path, issues),
    `${path}.end_date`, issues)
  result.skills = names(alias(source, 'skills', ['technologies'], path, issues), `${path}.skills`, issues)
  return result
}

function normalizeEntry(value: unknown, kind: keyof typeof ENTRY_FIELDS, index: number,
  issues: ValidationIssue[]) {
  const path = `profile.${kind}[${index}]`
  const entry = object(value) ? value : {}
  if (!object(value)) required(issues, path, `${kind} entry`, '{ "data": { ... } }')
  const source = object(entry.data) ? entry.data : entry
  if (!object(entry.data)) hint(issues, path, 'Recognized an unwrapped entry.',
    'Wrapped it in data.', '{ "action": "upsert", "data": { ... } }', true)
  const data = normalizedData(source, kind, `${path}.data`, issues)
  const requiredFields = kind === 'experience' ? ['company', 'job_title'] : ['school']
  requiredFields.forEach(key => {
    if (!textValue(data[key])) required(issues, `${path}.data.${key}`, key,
      `"${key}": "${key === 'school' ? 'University' : key === 'company' ? 'Company' : 'Job title'}"`)
  })
  const rawMatch = object(entry.match) ? entry.match : {}
  const matchSource = { ...data, ...rawMatch }
  const match = normalizedData(matchSource, kind, `${path}.match`, [])
  return { action: 'upsert', match, data }
}

export function normalizeEntries(
  value: unknown, kind: keyof typeof ENTRY_FIELDS, issues: ValidationIssue[]
) {
  return list(value, `profile.${kind}`, issues).map((entry, index) =>
    normalizeEntry(entry, kind, index, issues))
}
