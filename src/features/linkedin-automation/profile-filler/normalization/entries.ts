import type { JsonObject, ValidationIssue } from '../input-types.ts'
import { alias, dateValue, hint, list, names, object, required, textValue } from './shared.ts'

const fields = {
  experience: {
    required: [['company', ['company_name', 'employer']],
      ['job_title', ['jobTitle', 'title', 'position']]],
    optional: [['employment_type', ['employmentType', 'job_type']], ['location', ['city']],
      ['workplace_type', ['workplaceType', 'presence']], ['description', ['summary']],
      ['source_of_hire', ['sourceOfHire']]]
  },
  education: {
    required: [['school', ['university', 'institution']],
      ['degree', ['degree_name']], ['field_of_study', ['fieldOfStudy', 'field']]],
    optional: [['grade', []], ['activities', ['activities_and_societies']],
      ['description', ['summary']]]
  }
} as const

function normalizedData(source: JsonObject, kind: keyof typeof fields, path: string,
  issues: ValidationIssue[]) {
  const result: JsonObject = {}
  for (const [key, alternatives] of [...fields[kind].required, ...fields[kind].optional]) {
    const value = alias(source, key, [...alternatives], path, issues)
    if (value !== undefined) result[key] = textValue(value)
  }
  result.start_date = dateValue(alias(source, 'start_date', ['startDate', 'start'], path, issues),
    `${path}.start_date`, issues)
  result.end_date = dateValue(alias(source, 'end_date', ['endDate', 'end'], path, issues),
    `${path}.end_date`, issues)
  result.skills = names(alias(source, 'skills', ['technologies'], path, issues), `${path}.skills`, issues)
  return result
}

function normalizeEntry(value: unknown, kind: keyof typeof fields, index: number,
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

export function normalizeEntries(value: unknown, kind: keyof typeof fields, issues: ValidationIssue[]) {
  return list(value, `profile.${kind}`, issues).map((entry, index) =>
    normalizeEntry(entry, kind, index, issues))
}
