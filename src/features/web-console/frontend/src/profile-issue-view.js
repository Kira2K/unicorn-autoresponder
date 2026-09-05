import { profileSection } from './profile-workflow-view.js'
export function issueTitle(issue) {
  const path = String(issue.path || '')
  const section = path.split('.')[1]?.split('[')[0]
  const index = path.match(/\[(\d+)\]/)?.[1]
  return profileSection(section) + (index !== undefined ? ` · запись ${Number(index) + 1}` : '')
}
export function issueMessage(issue) {
  const message = String(issue.message || '')
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
