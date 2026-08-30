import type { CvFacts } from './types.ts'
import type { ValidationIssue } from '../input-types.ts'
import {
  allFactMetrics, allowedExperienceMetrics, unsupportedMetrics
} from './metric-claims.ts'

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()
const same = (left: unknown, right: unknown) => norm(left) === norm(right)

function mismatch(issues: ValidationIssue[], path: string, field: string) {
  issues.push({ level: 'fatal', path, message: `${field} does not match the final CV.`,
    resolution: 'Regenerate from the approved CV or correct the source CV.' })
}

export function factIssues(document: any, facts: CvFacts): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const generatedExperience = document?.profile?.experience ?? []
  if (generatedExperience.length !== facts.experience.length) {
    mismatch(issues, 'profile.experience', 'Experience count')
  }
  generatedExperience.forEach((entry: any, index: number) => {
    const fact = facts.experience[index]
    if (!fact) return
    const data = entry.data ?? {}
    for (const key of ['company', 'job_title', 'start_date', 'end_date'] as const) {
      if (!same(data[key], fact[key])) mismatch(issues, `profile.experience[${index}].data.${key}`, key)
    }
    const unsupported = unsupportedMetrics(data.description, allowedExperienceMetrics(fact))
    if (unsupported.length) {
      const values = unsupported.map(item => `"${item.raw}"`).join(', ')
      issues.push({ level: 'fatal', path: `profile.experience[${index}].data.description`,
        message: `Experience metrics ${values} are not supported by this CV position.`,
        resolution: 'Rewrite or remove only the unsupported numeric claims.' })
    }
  })
  const educationFacts = facts.education.filter(item => item.is_higher_education)
  const generatedEducation = document?.profile?.education ?? []
  if (generatedEducation.length !== educationFacts.length) mismatch(issues, 'profile.education', 'Education count')
  generatedEducation.forEach((entry: any, index: number) => {
    const fact = educationFacts[index]
    if (!fact) return
    const data = entry.data ?? {}
    for (const key of ['school', 'degree', 'field_of_study', 'start_date', 'end_date'] as const) {
      if (!same(data[key], fact[key])) mismatch(issues, `profile.education[${index}].data.${key}`, key)
    }
  })
  const about = String(document?.profile?.about ?? '')
  const headline = String(document?.profile?.headline ?? '')
  const unsupported = unsupportedMetrics(`${headline}\n${about}`, allFactMetrics(facts))
  if (unsupported.length) {
    const values = unsupported.map(item => `"${item.raw}"`).join(', ')
    issues.push({ level: 'fatal', path: 'profile.about',
      message: `Profile metrics ${values} are not supported by the final CV.`,
      resolution: 'Rewrite or remove only the unsupported numeric claims.' })
  }
  if (facts.target_roles.length && !facts.target_roles.some(role =>
    norm(headline).includes(norm(role)))) mismatch(issues, 'profile.headline', 'Target role')
  const emails = about.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g) ?? []
  if (emails.some(value => !same(value, facts.contact_email))) mismatch(issues, 'profile.about', 'Contact email')
  const phones = about.match(/\+?\d[\d\s().-]{7,}\d/g) ?? []
  const expectedPhone = norm(facts.contact_phone).replace(/\D/g, '')
  if (phones.some(value => value.replace(/\D/g, '') !== expectedPhone)) {
    mismatch(issues, 'profile.about', 'Contact phone')
  }
  return issues
}
