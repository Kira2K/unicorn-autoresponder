import { profileSection } from './profile-workflow-view.js'
export function issueTitle(issue) {
  const path = String(issue.path || '')
  const section = path.split('.')[1]?.split('[')[0]
  const index = path.match(/\[(\d+)\]/)?.[1]
  return profileSection(section) + (index !== undefined ? ` · запись ${Number(index) + 1}` : '')
}
export function issueMessage(issue) {
  const message = String(issue.message || '')
  const date = message.match(/^Unipile requires a month to write (start_date|end_date);/)
  if (date) return `В CV не указан месяц ${date[1] === 'start_date' ? 'начала' : 'окончания'}. Без него эту запись нельзя отправить в LinkedIn.`
  if (message.startsWith('The CV says Present')) return 'В CV запись отмечена как текущая, а в LinkedIn есть дата окончания.'
  if (/requires start_date to create/.test(message)) return 'Для новой записи нужна дата начала: год и месяц.'
  if (/has no stable LinkedIn ID/.test(message)) return 'У существующей записи не получен LinkedIn ID. Без него обновление небезопасно.'
  if (/Skills would exceed/.test(message)) return 'Часть навыков записи не помещается в общий лимит 100 навыков.'
  if (/not returned|temporarily unavailable/i.test(message)) return 'LinkedIn не вернул данные раздела. Они не считаются отсутствующими.'
  if (issue.path === 'profile.skills.omitted' && issue.suggestions?.length) {
    return `Не помещаются в лимит 100 навыков: ${issue.suggestions.join(', ')}.`
  }
  if (/[а-яё]/i.test(message)) return message
  if (message.startsWith('Unapplied skill:')) return message.replace('Unapplied skill:', 'Не применён навык:')
  if (message === 'Profile wrapper was missing.') return 'Структура документа исправлена автоматически.'
  if (/temporarily unavailable/i.test(message)) return 'Раздел LinkedIn временно недоступен. Подготовьте изменения позже.'
  if (/ambiguous|multiple|more than one/i.test(message)) return 'Найдено несколько возможных совпадений. Нужно уточнить запись.'
  if (/Only \d+ of 100 Skills/.test(message)) return message.replace(/Only (\d+) of 100 Skills are planned\./,
    'В плане только $1 из 100 навыков. Нужна повторная подготовка из CV.')
  return issue.level === 'fatal' ? 'Данные не прошли проверку. Уточните поле по подробностям ниже.'
    : 'Для этого раздела есть замечание. Проверьте подробности перед применением.'
}
export function issueResolution(issue) {
  const value = String(issue.resolution || '')
  if (/[а-яё]/i.test(value)) return value
  if (/missing date|requires a month/.test(`${value} ${issue.message}`)) {
    return 'Укажите подтверждённую дату через карандаш рядом с полем. Месяц автоматически не подставляется.'
  }
  if (/Mark the entry as current/.test(value)) return 'Отметьте запись как текущую в LinkedIn и подготовьте новый Preview.'
  if (/readable|Refresh the profile/.test(value)) return 'Дождитесь доступности раздела и подготовьте новый Preview.'
  if (/ambiguous|duplicate|difference before Apply/.test(value)) return 'Уточните совпадение с существующей записью. Возможный дубль отправлен не будет.'
  if (/partially completed|omitted from this write/.test(value)) return 'Остальные доступные изменения можно применить. Эти данные будут пропущены; результат будет частичным.'
  if (/verified catalog/.test(value)) return 'Уточните значение в каталоге LinkedIn. Неподтверждённое значение отправлено не будет.'
  return value ? 'Исправьте поле через карандаш. Правка будет проверена отдельно.' : ''
}
