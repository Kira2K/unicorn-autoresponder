import type { JsonObject, ProfileInput, ValidationIssue } from './input-types.ts'
import { editableField, fieldChoices, listFields } from './editable-fields.ts'
import { codedError } from './errors.ts'
import { profileDocument } from './profile-document.ts'
import { validateProfileFile } from './validator.ts'

export type FieldChange = { path: string; value: string | string[] } | { path: string; enabled: boolean }
export function changeProfileField(input: ProfileInput, change: Extract<FieldChange, { value: unknown }>) {
  const field = editableField(change.path)
  const fail = (message: string): never => { throw codedError('profile_field_invalid', message,
    [{ level: 'fatal', path: change.path, message } satisfies ValidationIssue]) }
  if (!field) return fail('Это поле нельзя изменять. Связь с CV и состав записей сохраняются.')
  const { section, key, index } = field
  const list = listFields.has(key)
  if (list ? !Array.isArray(change.value) || change.value.some(item => typeof item !== 'string')
    : typeof change.value !== 'string') return fail('Неверный формат значения поля.')
  const value = Array.isArray(change.value) ? [...new Set(change.value.map(item => item.trim()).filter(Boolean))]
    : change.value.trim()
  if (JSON.stringify(value).length > 20_000) return fail('Значение поля слишком длинное.')
  if (['company', 'job_title', 'school', 'headline'].includes(key) && !value.length) return fail('Заполните это поле.')
  if ((key === 'start_date' || key === 'end_date') && section !== 'open_to_work' && value &&
    !/^((?:19|20|21)\d{2})(?:-(0[1-9]|1[0-2]))?$/.test(String(value)) && !(key === 'end_date' && value === 'present')) {
    return fail('Укажите дату в формате ГГГГ-ММ или ГГГГ. Для текущей записи: present.')
  }
  if (section === 'open_to_work' && key === 'start_date' && value && !['IMMEDIATELY', 'FLEXIBLE'].includes(String(value))) {
    return fail('Выберите IMMEDIATELY или FLEXIBLE.')
  }
  const choices = fieldChoices[key]
  if (choices && (Array.isArray(value) ? value : value ? [value] : []).some(item => !choices.includes(item))) {
    return fail(`Допустимые значения: ${choices.join(', ')}.`)
  }
  if (list && value.length > (section === 'skills' || key === 'skills' ? 100 : 20)) return fail('Слишком много значений в поле.')
  const document = profileDocument(input)
  const profile = document.profile as JsonObject
  let target = profile
  if (index !== undefined) {
    const entry = (profile[section] as JsonObject[])[index]
    if (!entry) return fail('Запись не найдена. Обновите Preview.')
    target = entry.data as JsonObject
  } else if (section === 'skills' || section === 'open_to_work') {
    target = profile[section] as JsonObject
    if (!target) return fail('Этого раздела нет в подготовленном профиле.')
  }
  const originalValue = target[key]
  if (value === '') delete target[key]
  else target[key] = ['job_titles', 'locations'].includes(key) ? (value as string[]).map(name => ({ name })) : value
  const parsed = validateProfileFile(document)
  if (!parsed.value) return fail('Поле не прошло проверку.')
  if (section === 'open_to_work' && !parsed.value.openToWork) return fail('Заполните должности, местоположения и формат работы.')
  for (const name of ['experience', 'education'] as const) {
    if (parsed.value[name].length !== input[name].length) return fail('Правка не должна удалять записи CV. Заполните обязательные поля.')
    parsed.value[name].forEach((entry, i) => { entry.factId = input[name][i].factId; entry.match = structuredClone(input[name][i].match) })
  }
  if (index !== undefined) {
    const entry = (section === 'experience' ? parsed.value.experience : parsed.value.education)[index].data
    if (entry.startDate && entry.endDate && (entry.startDate.year > entry.endDate.year ||
      (entry.startDate.year === entry.endDate.year && entry.startDate.month && entry.endDate.month && entry.startDate.month > entry.endDate.month))) {
      return fail('Дата окончания не может быть раньше даты начала.')
    }
  }
  const invalid = parsed.issues.filter(issue => issue.path === change.path || issue.path.startsWith(`${change.path}[`))
  if (invalid.length) throw codedError('profile_field_invalid', 'Исправьте значение поля.',
    invalid.map(issue => ({ ...issue, level: 'fatal' })))
  const updated = structuredClone(input)
  if (index !== undefined) {
    if (section === 'experience') updated.experience[index].data = parsed.value.experience[index].data
    else updated.education[index].data = parsed.value.education[index].data
  } else if (section === 'open_to_work') updated.openToWork = parsed.value.openToWork
  else if (section === 'skills') updated.skills = parsed.value.skills
  else if (section === 'headline') updated.headline = parsed.value.headline
  else updated.about = parsed.value.about
  return { input: updated, originalValue, value, section }
}
