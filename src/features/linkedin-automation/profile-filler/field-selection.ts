import type { ProfileInput, ValidationIssue, ExperienceData, EducationData } from './input-types.ts'
import { editableField, editableFields } from './editable-fields.ts'
import { codedError } from './errors.ts'
import { executableInput } from './partial-plan.ts'

export type EntryWrite<T> = Partial<T> & { skills: string[] }
export type ExperienceWrite = EntryWrite<ExperienceData>
export type EducationWrite = EntryWrite<EducationData>
export const fieldDisabled = (disabled: string[], path: string) => disabled.some(parent =>
  path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`))
export const entrySelected = (section: string, index: number, disabled: string[]) =>
  !editableFields[section].every(key => fieldDisabled(disabled, `profile.${section}[${index}].data.${key}`))
export function selectedEntriesInput(input: ProfileInput, disabled: string[] = [], skipped: string[] = []) {
  const excluded = (['experience', 'education'] as const).flatMap(section => input[section].flatMap((_, index) =>
    entrySelected(section, index, disabled) ? [] : [`profile.${section}[${index}]`]))
  return executableInput(input, [...skipped, ...excluded])
}

export function selectField(input: ProfileInput, disabled: string[], path: string, enabled: boolean) {
  const section = /^profile\.(experience|education|skills|open_to_work)$/.exec(path)?.[1]
  if (section && typeof enabled === 'boolean' && (section !== 'open_to_work' || input.openToWork)) {
    const paths = ['experience', 'education'].includes(section)
      ? input[section as 'experience' | 'education'].flatMap((_, index) => editableFields[section]
        .map(key => `${path}[${index}].data.${key}`)) : editableFields[section].map(key => `${path}.${key}`)
    return { section, disabled: enabled ? disabled.filter(item => !fieldDisabled([path], item))
      : [...new Set([...disabled, path, ...paths])].sort() }
  }
  const field = editableField(path)
  const entries = field?.section === 'experience' ? input.experience : input.education
  if (!field || typeof enabled !== 'boolean' || (field.index !== undefined && !entries[field.index]) ||
    (field.section === 'open_to_work' && !input.openToWork)) {
    throw codedError('profile_field_invalid', 'Это поле нельзя включить или выключить.')
  }
  return { section: field.section, disabled: enabled ? disabled.filter(item => item !== path)
    : [...new Set([...disabled, path])].sort() }
}

export function selectedEntry<T extends ExperienceData | EducationData>(data: T, section: string,
  index: number, disabled: string[]): EntryWrite<T> | undefined {
  const prefix = `profile.${section}[${index}].data`
  if (!entrySelected(section, index, disabled)) return undefined
  const selected: EntryWrite<T> = structuredClone(data)
  for (const path of disabled.filter(path => path.startsWith(`${prefix}.`))) {
    const key = path.slice(prefix.length + 1).replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    Reflect.deleteProperty(selected, key)
    if (key === 'endDate') Reflect.deleteProperty(selected, 'isCurrent')
  }
  selected.skills ??= []
  return selected
}

export function requireSelectedIdentity(data: ExperienceWrite | EducationWrite, section: string,
  index: number, issues: ValidationIssue[]) {
  const required = section === 'experience' ? ['company', 'jobTitle', 'startDate'] : ['school', 'startDate']
  const missing = required.filter(key => !Reflect.get(data, key))
  for (const key of missing) issues.push({ level: 'fatal',
    path: `profile.${section}[${index}].data.${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`,
    message: 'Без этого поля нельзя создать новую запись.',
    resolution: 'Включите и заполните обязательное поле или исключите все поля этой записи.' })
  return !missing.length
}
