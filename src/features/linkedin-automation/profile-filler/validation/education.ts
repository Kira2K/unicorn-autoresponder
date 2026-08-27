import type { EducationUpsert, ValidationIssue } from '../input-types.ts'
import { isObject, optionalDate, strings, text, warning } from './shared.ts'

export function parseEducation(value: unknown, issues: ValidationIssue[]): EducationUpsert[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    warning(issues, 'profile.education', 'Ожидался массив.', 'Education пропущен.')
    return []
  }
  return value.flatMap((item, index) => {
    const path = `profile.education[${index}]`
    if (!isObject(item) || !isObject(item.data)) {
      warning(issues, path, 'Ожидался объект с data.', 'Запись пропущена.')
      return []
    }
    if (item.action !== undefined && item.action !== 'upsert') {
      warning(issues, `${path}.action`, 'Поддерживается только upsert.', 'Запись пропущена.')
      return []
    }
    const data = item.data
    const school = text(data.school)
    const startDate = optionalDate(data.start_date, `${path}.data.start_date`, issues)
    if (!school) {
      warning(issues, path, 'Нужен school.', 'Запись пропущена.')
      return []
    }
    const match = isObject(item.match) ? item.match : {}
    const skills = strings(data.skills, `${path}.data.skills`, issues)
    return [{
      match: {
        school: text(match.school) ?? school,
        startDate: optionalDate(match.start_date, `${path}.match.start_date`, issues) ?? startDate
      },
      data: {
        school, startDate, degree: text(data.degree), fieldOfStudy: text(data.field_of_study),
        endDate: optionalDate(data.end_date, `${path}.data.end_date`, issues),
        grade: text(data.grade),
        activities: typeof data.activities === 'string' ? data.activities : undefined,
        description: typeof data.description === 'string' ? data.description : undefined,
        skills
      }
    }]
  })
}
