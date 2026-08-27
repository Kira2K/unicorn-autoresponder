import { codedError } from '../errors.ts'
import type { CvFacts } from './types.ts'

const ROOT = ['target_roles', 'years_experience', 'contact_email', 'contact_phone',
  'industries', 'skills', 'experience', 'education']
const EXPERIENCE = ['company', 'job_title', 'start_date', 'end_date', 'location',
  'workplace_type', 'achievements', 'responsibilities', 'technologies', 'evidence']
const EDUCATION = ['school', 'degree', 'field_of_study', 'start_date', 'end_date', 'grade',
  'activities', 'evidence', 'is_higher_education']

function exactKeys(value: any, keys: string[]) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value)
}

const text = (value: unknown) => typeof value === 'string'
const nullableText = (value: unknown) => value === null || text(value)
const texts = (value: unknown) => Array.isArray(value) && value.every(text)
const date = (value: unknown) => value === null || typeof value === 'string' &&
  /^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value)

function validExperience(item: any) {
  return exactKeys(item, EXPERIENCE) && text(item.company) && text(item.job_title) &&
    date(item.start_date) && date(item.end_date) && nullableText(item.location) &&
    (item.workplace_type === null || ['ON_SITE', 'HYBRID', 'REMOTE'].includes(item.workplace_type)) &&
    ['achievements', 'responsibilities', 'technologies'].every(key => texts(item[key])) &&
    text(item.evidence)
}

function validEducation(item: any) {
  return exactKeys(item, EDUCATION) && text(item.school) &&
    ['degree', 'field_of_study', 'grade', 'activities'].every(key => nullableText(item[key])) &&
    date(item.start_date) && date(item.end_date) && text(item.evidence) &&
    typeof item.is_higher_education === 'boolean'
}

export function assertCvFacts(value: any): CvFacts {
  const valid = exactKeys(value, ROOT) && ['target_roles', 'industries', 'skills',
    'experience', 'education'].every(key => Array.isArray(value[key])) &&
    texts(value.target_roles) && texts(value.industries) && texts(value.skills) &&
    (value.years_experience === null || typeof value.years_experience === 'number' &&
      value.years_experience >= 0 && value.years_experience <= 80) &&
    nullableText(value.contact_email) && nullableText(value.contact_phone) &&
    value.experience.every(validExperience) && value.education.every(validEducation)
  if (!valid) throw codedError('openai_response_invalid',
    'OpenAI returned invalid CV facts.')
  return value as CvFacts
}
