import type { ValidationIssue } from '../input-types.ts'

const DATE = /^(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2]))?$/
const WORKPLACE = new Set(['ON_SITE', 'HYBRID', 'REMOTE'])

function fatal(issues: ValidationIssue[], path: string, message: string) {
  issues.push({ level: 'fatal', path, message, resolution: 'Regenerate or edit the draft.' })
}
const object = (value: unknown) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0
const texts = (value: unknown) => Array.isArray(value) && value.every(text)
const date = (value: unknown) => value === undefined || typeof value === 'string' && DATE.test(value)
const endDate = (value: unknown) => value === 'present' || date(value)
const optionalText = (value: unknown) => value === undefined || typeof value === 'string'
const parameters = (value: unknown) => Array.isArray(value) &&
  value.every(item => object(item) && text((item as any).name))

function experienceIssues(entries: any, issues: ValidationIssue[]) {
  if (!Array.isArray(entries)) return fatal(issues, 'profile.experience', 'Experience must be an array.')
  entries.forEach((entry, index) => {
    const path = `profile.experience[${index}]`; const data = entry?.data; const match = entry?.match
    if (entry?.action !== 'upsert' || !object(data) || !object(match)) {
      fatal(issues, path, 'Experience must use upsert with match and data.'); return
    }
    if (!text(data.company) || !text(data.job_title) || !text(data.description) ||
      !texts(data.skills) || !optionalText(data.location) || data.source_of_hire !== undefined) {
      fatal(issues, `${path}.data`, 'Experience company, job title and skills are required.')
    }
    if (!date(data.start_date) || !endDate(data.end_date) ||
      data.workplace_type !== undefined && !WORKPLACE.has(data.workplace_type)) {
      fatal(issues, `${path}.data`, 'Experience dates or workplace type are invalid.')
    }
    if (match.company !== data.company || match.job_title !== data.job_title ||
      match.start_date !== data.start_date) fatal(issues, `${path}.match`, 'Experience match must equal its data.')
  })
}

function educationIssues(entries: any, issues: ValidationIssue[]) {
  if (!Array.isArray(entries)) return fatal(issues, 'profile.education', 'Education must be an array.')
  entries.forEach((entry, index) => {
    const path = `profile.education[${index}]`; const data = entry?.data; const match = entry?.match
    if (entry?.action !== 'upsert' || !object(data) || !object(match)) {
      fatal(issues, path, 'Education must use upsert with match and data.'); return
    }
    if (!text(data.school) || !text(data.description) || !texts(data.skills) ||
      !date(data.start_date) || !endDate(data.end_date) ||
      !['degree', 'field_of_study', 'grade', 'activities'].every(key => optionalText(data[key]))) {
      fatal(issues, `${path}.data`, 'Education school, skills or dates are invalid.')
    }
    if (match.school !== data.school || match.start_date !== data.start_date) {
      fatal(issues, `${path}.match`, 'Education match must equal its data.')
    }
  })
}

export function shapeIssues(document: any): ValidationIssue[] {
  const issues: ValidationIssue[] = []; const profile = document?.profile
  if (!object(document) || document.schema_version !== 1 || !object(profile)) {
    fatal(issues, 'root', 'Generated document must use Profile Filler schema version 1.'); return issues
  }
  if (!text(profile.headline) || !text(profile.about)) fatal(issues, 'profile', 'Headline and About are required.')
  if (!object(profile.skills) || !texts(profile.skills?.add) || profile.skills?.target_count !== 100) {
    fatal(issues, 'profile.skills', 'Skills have an invalid shape.')
  }
  experienceIssues(profile.experience, issues); educationIssues(profile.education, issues)
  const open = profile.open_to_work
  if (!object(open) || !parameters(open.job_titles) || !parameters(open.locations)) {
    fatal(issues, 'profile.open_to_work', 'Open to Work has an invalid shape.')
  }
  return issues
}
