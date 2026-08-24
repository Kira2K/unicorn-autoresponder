import type { ExperienceUpsert, ValidationIssue } from '../input-types.ts'
import { isObject, optionalDate, strings, text, warning } from './shared.ts'

const WORKPLACES = new Set(['ON_SITE', 'HYBRID', 'REMOTE'])
const SOURCES = new Set(['INDEED', 'LINKEDIN', 'COMPANY_WEBSITE', 'OTHER_JOB_SITES',
  'REFERRAL', 'CONTACTED_BY_RECRUITER', 'STAFFING_AGENCY', 'OTHER'])

export function parseExperience(value: unknown, issues: ValidationIssue[]): ExperienceUpsert[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warning(issues, 'profile.experience', 'Ожидался массив.', 'Experience пропущен.')
    return []
  }
  return value.flatMap((item, index) => {
    const path = `profile.experience[${index}]`
    if (!isObject(item) || !isObject(item.data)) {
      warning(issues, path, 'Ожидался объект с data.', 'Запись пропущена.')
      return []
    }
    if (item.action !== undefined && item.action !== 'upsert') {
      warning(issues, `${path}.action`, 'Поддерживается только upsert.', 'Запись пропущена.')
      return []
    }
    const data = item.data
    const company = text(data.company)
    const jobTitle = text(data.job_title)
    const startDate = optionalDate(data.start_date, `${path}.data.start_date`, issues)
    if (!company || !jobTitle) {
      warning(issues, path, 'Нужны company и job_title.', 'Запись пропущена.')
      return []
    }
    const skills = strings(data.skills, `${path}.data.skills`, issues)
    const workplace = text(data.workplace_type)?.toUpperCase()
    const workplaceType = workplace && WORKPLACES.has(workplace)
      ? workplace as ExperienceUpsert['data']['workplaceType'] : undefined
    if (workplace && !workplaceType) warning(issues, `${path}.data.workplace_type`, 'Неизвестный тип работы.')
    const source = text(data.source_of_hire)?.toUpperCase()
    const sourceOfHire = source && SOURCES.has(source) ? source : undefined
    if (source && !sourceOfHire) warning(issues, `${path}.data.source_of_hire`,
      'Значение не поддерживается MCP v2.', 'Поле пропущено; выберите значение из подсказки.')
    const match = isObject(item.match) ? item.match : {}
    return [{
      match: {
        company: text(match.company) ?? company,
        jobTitle: text(match.job_title) ?? jobTitle,
        startDate: optionalDate(match.start_date, `${path}.match.start_date`, issues) ?? startDate
      },
      data: {
        company, jobTitle, startDate, workplaceType,
        employmentType: text(data.employment_type), location: text(data.location),
        endDate: optionalDate(data.end_date, `${path}.data.end_date`, issues),
        description: typeof data.description === 'string' ? data.description : undefined,
        sourceOfHire, skills
      }
    }]
  })
}
