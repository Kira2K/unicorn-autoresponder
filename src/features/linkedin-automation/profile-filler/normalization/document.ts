import type { JsonObject, ValidationIssue } from '../input-types.ts'
import { normalizeEntries } from './entries.ts'
import { alias, hint, list, names, object, textValue } from './shared.ts'

const PROFILE_KEYS = new Set(['schema_version', 'headline', 'professional_headline', 'about',
  'summary', 'bio', 'skills', 'competencies', 'experience', 'experiences',
  'work_experience', 'workExperience', 'education', 'educations', 'academic_background',
  'open_to_work', 'openToWork'])
const OPEN_KEYS = new Set(['enabled', 'job_titles', 'jobTitles', 'titles', 'workplace_types',
  'workplaceTypes', 'workplaces', 'locations', 'location', 'employment_types',
  'employmentTypes', 'employment_type', 'start_date', 'startDate', 'visibility'])

function normalizeSkills(value: unknown, issues: ValidationIssue[]) {
  if (Array.isArray(value)) {
    hint(issues, 'profile.skills', 'Recognized Skills as an array.',
      'Converted to the canonical Skills object.', '{ "add": [...] }', true)
    return { add: names(value, 'profile.skills.add', issues), target_count: 100 }
  }
  const source = object(value) ? value : {}
  return {
    add: names(alias(source, 'add', ['items', 'list'], 'profile.skills', issues),
      'profile.skills.add', issues),
    target_count: Number(alias(source, 'target_count', ['targetCount'], 'profile.skills', issues) ?? 100)
  }
}

function parameters(value: unknown, path: string, issues: ValidationIssue[]) {
  return list(value, path, issues).map((item, index) => {
    const name = textValue(item)
    if (object(item) && item.id !== undefined) hint(issues, `${path}[${index}].id`,
      'Input LinkedIn ID was ignored.', 'Preview will resolve a fresh ID by name.', undefined, true)
    return { name }
  })
}

function normalizeOpenToWork(value: unknown, issues: ValidationIssue[]) {
  if (!object(value)) return value
  Object.keys(value).filter(key => !OPEN_KEYS.has(key)).forEach(key => hint(issues,
    `profile.open_to_work.${key}`, 'Unsupported field was ignored.',
    'Only fields supported by Profile Filler are kept.', undefined, true))
  const result: JsonObject = { enabled: value.enabled ?? true }
  const mappings = [
    ['job_titles', ['jobTitles', 'titles']], ['workplace_types', ['workplaceTypes', 'workplaces']],
    ['locations', ['location']], ['employment_types', ['employmentTypes', 'employment_type']]
  ] as const
  mappings.forEach(([key, alternatives]) => {
    const found = alias(value, key, [...alternatives], 'profile.open_to_work', issues)
    if (found !== undefined) result[key] = ['job_titles', 'locations'].includes(key)
      ? parameters(found, `profile.open_to_work.${key}`, issues)
      : list(found, `profile.open_to_work.${key}`, issues)
  })
  result.start_date = alias(value, 'start_date', ['startDate'], 'profile.open_to_work', issues)
  result.visibility = textValue(value.visibility).toUpperCase()
  return result
}

export function normalizeProfileDocument(input: unknown) {
  const issues: ValidationIssue[] = []
  if (!object(input)) return { issues: [{ level: 'fatal', path: 'profile',
    message: 'JSON root must be an object.', resolution: 'Upload a JSON object.' } satisfies ValidationIssue] }
  const root = object(input.profile) ? input.profile : input
  if (!object(input.profile)) hint(issues, 'profile', 'Profile wrapper was missing.',
    'Wrapped the document in profile.', '{ "profile": { ... } }', true)
  Object.keys(root).filter(key => !PROFILE_KEYS.has(key)).forEach(key => hint(issues,
    `profile.${key}`, 'Unsupported field was ignored.',
    'Only fields supported by Profile Filler are kept.', undefined, true))
  const profile: JsonObject = {}
  const headline = alias(root, 'headline', ['professional_headline'], 'profile', issues)
  const about = alias(root, 'about', ['summary', 'bio'], 'profile', issues)
  if (headline !== undefined) profile.headline = textValue(headline)
  if (about !== undefined) profile.about = typeof about === 'string' ? about : textValue(about)
  const skills = alias(root, 'skills', ['competencies'], 'profile', issues)
  if (skills !== undefined) profile.skills = normalizeSkills(skills, issues)
  const experience = alias(root, 'experience', ['experiences', 'work_experience', 'workExperience'],
    'profile', issues)
  if (experience !== undefined) profile.experience = normalizeEntries(experience, 'experience', issues)
  const education = alias(root, 'education', ['educations', 'academic_background'], 'profile', issues)
  if (education !== undefined) profile.education = normalizeEntries(education, 'education', issues)
  const open = alias(root, 'open_to_work', ['openToWork'], 'profile', issues)
  if (open !== undefined) profile.open_to_work = normalizeOpenToWork(open, issues)
  return { document: { schema_version: 1, profile }, issues }
}
