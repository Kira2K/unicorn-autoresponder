import type { ValidationIssue } from '../input-types.ts'
import { LINKEDIN_GUIDE } from './guide-rules.ts'

const CYRILLIC = /[\u0400-\u04FF]/u
const PSEUDO_BOLD = /[\u{1D400}-\u{1D7FF}]/u

function fatal(issues: ValidationIssue[], path: string, message: string) {
  issues.push({ level: 'fatal', path, message, resolution: 'Regenerate or edit the draft.' })
}

function allStrings(value: unknown, path = 'profile'): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, index) => allStrings(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, item]) => allStrings(item, `${path}.${key}`))
}

function validateLanguage(profile: any, issues: ValidationIssue[]) {
  for (const [path, value] of allStrings(profile)) {
    if (CYRILLIC.test(value)) fatal(issues, path, 'Generated profile must be fully in English.')
    if (PSEUDO_BOLD.test(value)) fatal(issues, path, 'Pseudo-bold Unicode is forbidden by the guide.')
  }
}

function validateText(profile: any, issues: ValidationIssue[]) {
  const headline = String(profile.headline ?? '')
  const about = String(profile.about ?? '')
  if (!headline || headline.length > LINKEDIN_GUIDE.headlineMax) {
    fatal(issues, 'profile.headline', 'Headline must contain 1-220 characters.')
  }
  if (!about || about.length > LINKEDIN_GUIDE.aboutMax) {
    fatal(issues, 'profile.about', 'About must contain 1-2600 characters.')
  }
  const blocks = about.trim().split(/\n\s*\n/).filter(Boolean).length
  if (blocks < 4 || blocks > 5) fatal(issues, 'profile.about', 'About must contain 4-5 blocks.')
  const lower = `${headline}\n${about}`.toLowerCase()
  if (/salary|compensation|зарплат/u.test(lower)) fatal(issues, 'profile.about', 'Salary must not be mentioned.')
  LINKEDIN_GUIDE.bannedPhrases.filter(value => lower.includes(value)).forEach(value =>
    fatal(issues, 'profile.about', `Forbidden AI phrase: ${value}.`))
}

function validateSkills(profile: any, issues: ValidationIssue[]) {
  const skills = profile.skills?.add ?? []
  const unique = new Set(skills.map((value: unknown) => String(value).trim().toLowerCase()))
  if (skills.length !== 100 || unique.size !== 100 || profile.skills?.target_count !== 100) {
    fatal(issues, 'profile.skills', 'Skills must contain exactly 100 unique values and target_count 100.')
  }
  const validateAttached = (values: unknown[], path: string) => {
    const keys = values.map(value => String(value).trim().toLowerCase())
    if (new Set(keys).size !== keys.length) fatal(issues, path, 'Attached Skills must be unique.')
    if (keys.some(value => !unique.has(value))) fatal(issues, path,
      'Every attached Skill must also exist in profile.skills.add.')
  }
  ;(profile.experience ?? []).forEach((entry: any, index: number) => {
    const description = String(entry.data?.description ?? '')
    if (!description || description.length > LINKEDIN_GUIDE.experienceDescriptionMax) {
      fatal(issues, `profile.experience[${index}].data.description`, 'Experience description must contain 1-2000 characters.')
    }
    const count = entry.data?.skills?.length ?? 0
    if (count < 5 || count > 15) fatal(issues, `profile.experience[${index}].data.skills`, 'Experience requires 5-15 skills.')
    validateAttached(entry.data?.skills ?? [], `profile.experience[${index}].data.skills`)
  })
  ;(profile.education ?? []).forEach((entry: any, index: number) => {
    if (!String(entry.data?.description ?? '').trim()) fatal(issues,
      `profile.education[${index}].data.description`, 'Education description is required by the guide.')
    if ((entry.data?.skills?.length ?? 0) < 5) fatal(issues,
      `profile.education[${index}].data.skills`, 'Education requires at least 5 skills.')
    validateAttached(entry.data?.skills ?? [], `profile.education[${index}].data.skills`)
  })
}

export function guideIssues(document: any, country: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const profile = document?.profile ?? {}
  validateLanguage(profile, issues); validateText(profile, issues); validateSkills(profile, issues)
  const open = profile.open_to_work ?? {}
  if ((open.job_titles?.length ?? 0) !== 5) fatal(issues, 'profile.open_to_work.job_titles', 'Exactly five job titles are required.')
  if (open.locations?.length !== 1 || open.locations[0]?.name !== country) fatal(issues,
    'profile.open_to_work.locations', 'Open to Work location must equal the proxy country.')
  if (JSON.stringify(open.workplace_types) !== JSON.stringify(['REMOTE', 'HYBRID', 'ON_SITE']) ||
    JSON.stringify(open.employment_types) !== JSON.stringify(['FULL_TIME', 'CONTRACT', 'PART_TIME']) ||
    open.start_date !== 'IMMEDIATELY' || open.visibility !== 'ALL') {
    fatal(issues, 'profile.open_to_work', 'Open to Work settings do not match the approved guide defaults.')
  }
  return issues
}
