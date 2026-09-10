const fields = {
  company: 'Компания', company_name: 'Компания', job_title: 'Должность', jobTitle: 'Должность',
  title: 'Должность', position: 'Должность', location: 'Местоположение',
  workplace_type: 'Формат работы', workplaceType: 'Формат работы',
  start_date: 'Начало', startDate: 'Начало', end_date: 'Окончание', endDate: 'Окончание',
  school: 'Учебное заведение', school_name: 'Учебное заведение', degree: 'Степень',
  field_of_study: 'Направление', fieldOfStudy: 'Направление', grade: 'Оценка',
  activities: 'Активности', description: 'Описание', skills: 'Навыки',
  job_titles: 'Должности', locations: 'Местоположения', workplace_types: 'Форматы работы',
  employment_types: 'Типы занятости', visibility: 'Кому видно', source_of_hire: 'Источник найма'
}
const values = { present: 'По настоящее время', ON_SITE: 'В офисе', REMOTE: 'Удалённо',
  HYBRID: 'Гибрид', ALL: 'Всем', RECRUITERS_ONLY: 'Только рекрутерам',
  IMMEDIATELY: 'Сразу', FLEXIBLE: 'По договорённости', FULL_TIME: 'Полная занятость',
  PART_TIME: 'Частичная занятость', CONTRACT: 'Контракт', INTERNSHIP: 'Стажировка' }
export function profileValue(value) {
  if (value === undefined || value === null || value === '') return 'Не указано'
  if (Array.isArray(value)) return value.map(profileValue).join(', ') || 'Не указано'
  if (typeof value !== 'object') return values[value] || String(value)
  if (value.year) return [value.month && String(value.month).padStart(2, '0'), value.year].filter(Boolean).join('.')
  if (value.name || value.label) return value.name || value.label
  return 'Нет данных'
}
export function profileRows(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).filter(([key]) => fields[key]).map(([key, item]) => ({
    key, label: fields[key], value: profileValue(item)
  }))
}
