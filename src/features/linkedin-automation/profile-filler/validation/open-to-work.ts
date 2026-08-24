import type { NamedParameter, OpenToWorkInput, ValidationIssue } from '../input-types.ts'
import { isObject, strings, text, warning } from './shared.ts'

const WORKPLACES = new Set(['ON_SITE', 'HYBRID', 'REMOTE'])
const EMPLOYMENT = new Set(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'])
const START = new Set(['IMMEDIATELY', 'FLEXIBLE'])
const VISIBILITY = new Set(['ALL', 'RECRUITERS_ONLY'])

function parameters(value: unknown, path: string, issues: ValidationIssue[]): NamedParameter[] {
  if (!Array.isArray(value)) { if (value !== undefined) warning(issues, path, 'Ожидался массив.'); return [] }
  return value.flatMap((item, index) => {
    const name = text(item) ?? (isObject(item) ? text(item.name ?? item.title) : undefined)
    if (!name) { warning(issues, `${path}[${index}]`, 'Не найдено название.'); return [] }
    return [{ name, ...(isObject(item) && text(item.id) ? { id: text(item.id) } : {}) }]
  })
}

function enums<T extends string>(
  value: unknown, allowed: Set<string>, path: string, issues: ValidationIssue[]
): T[] {
  return strings(value, path, issues).flatMap(item => {
    const normalized = item.toUpperCase()
    if (!allowed.has(normalized)) { warning(issues, path, `Неизвестное значение ${item}.`); return [] }
    return [normalized as T]
  })
}

export function parseOpenToWork(value: unknown, issues: ValidationIssue[]): OpenToWorkInput | undefined {
  if (value === undefined) return undefined
  if (!isObject(value) || value.enabled === false) {
    warning(issues, 'profile.open_to_work', 'Отключение Open to Work не поддерживается.')
    return undefined
  }
  const jobTitles = parameters(value.job_titles ?? value.job_title, 'profile.open_to_work.job_titles', issues)
  const locations = parameters(value.locations, 'profile.open_to_work.locations', issues)
  const workplaceTypes = enums<OpenToWorkInput['workplaceTypes'][number]>(
    value.workplace_types, WORKPLACES, 'profile.open_to_work.workplace_types', issues)
  const employmentTypes = enums<OpenToWorkInput['employmentTypes'][number]>(
    value.employment_types ?? value.employment_type, EMPLOYMENT,
    'profile.open_to_work.employment_types', issues)
  const rawStart = text(value.start_date)?.toUpperCase()
  const startDate = rawStart && START.has(rawStart) ? rawStart as OpenToWorkInput['startDate'] : undefined
  const rawVisibility = text(value.visibility)?.toUpperCase()
  const visibility = rawVisibility && VISIBILITY.has(rawVisibility)
    ? rawVisibility as OpenToWorkInput['visibility'] : undefined
  if (!jobTitles.length || !workplaceTypes.length || !visibility) {
    warning(issues, 'profile.open_to_work', 'Нужны job_titles, workplace_types и visibility.')
    return undefined
  }
  return { jobTitles, locations, workplaceTypes, employmentTypes, startDate, visibility }
}
