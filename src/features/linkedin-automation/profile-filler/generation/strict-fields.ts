import type { ValidationIssue } from '../input-types.ts'

const KEYS: Record<string, string[]> = {
  root: ['schema_version', 'profile'],
  profile: ['headline', 'about', 'skills', 'experience', 'education', 'open_to_work'],
  skills: ['add', 'target_count'],
  experience: ['action', 'match', 'data'],
  experienceMatch: ['company', 'job_title', 'start_date'],
  experienceData: ['company', 'job_title', 'location', 'workplace_type', 'start_date',
    'end_date', 'description', 'source_of_hire', 'skills'],
  education: ['action', 'match', 'data'],
  educationMatch: ['school', 'start_date'],
  educationData: ['school', 'degree', 'field_of_study', 'start_date', 'end_date', 'grade',
    'activities', 'description', 'skills'],
  open: ['job_titles', 'workplace_types', 'locations', 'start_date', 'employment_types', 'visibility'],
  parameter: ['name']
}
function inspect(value: any, allowed: string[], path: string, issues: ValidationIssue[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  Object.keys(value).filter(key => !allowed.includes(key)).forEach(key => issues.push({
    level: 'fatal', path: `${path}.${key}`, message: 'Generated field is not supported.',
    resolution: 'Remove the field from the generator output.'
  }))
}

export function strictFieldIssues(document: any): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  inspect(document, KEYS.root, 'root', issues)
  const profile = document?.profile
  inspect(profile, KEYS.profile, 'profile', issues)
  inspect(profile?.skills, KEYS.skills, 'profile.skills', issues)
  ;(profile?.experience ?? []).forEach((entry: any, index: number) => {
    inspect(entry, KEYS.experience, `profile.experience[${index}]`, issues)
    inspect(entry?.match, KEYS.experienceMatch, `profile.experience[${index}].match`, issues)
    inspect(entry?.data, KEYS.experienceData, `profile.experience[${index}].data`, issues)
  })
  ;(profile?.education ?? []).forEach((entry: any, index: number) => {
    inspect(entry, KEYS.education, `profile.education[${index}]`, issues)
    inspect(entry?.match, KEYS.educationMatch, `profile.education[${index}].match`, issues)
    inspect(entry?.data, KEYS.educationData, `profile.education[${index}].data`, issues)
  })
  inspect(profile?.open_to_work, KEYS.open, 'profile.open_to_work', issues)
  ;['job_titles', 'locations'].forEach(key => (profile?.open_to_work?.[key] ?? [])
    .forEach((item: any, index: number) => inspect(item, KEYS.parameter,
      `profile.open_to_work.${key}[${index}]`, issues)))
  return issues
}
