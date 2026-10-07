import type { CvExperience, CvEducation } from './types.ts'

export function contentText(value: string): string {
  return value.normalize('NFKC').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
}

const months = [
  ['январ', 'january'], ['феврал', 'february'], ['март', 'march'], ['апрел', 'april'],
  ['мая', 'май', 'may'], ['июн', 'june'], ['июл', 'july'], ['август', 'august'],
  ['сентябр', 'september'], ['октябр', 'october'], ['ноябр', 'november'], ['декабр', 'december']
]
function datePresent(text: string, date?: string): boolean {
  if (!date) return true
  if (text.includes(date)) return true
  const match = date.match(/^(\d{1,2})\/(\d{4})$/) ?? date.match(/^(\d{1,2})\.(\d{4})$/)
  if (!match) return false
  return (months[Number(match[1]) - 1] ?? []).some(month =>
    new RegExp(`${month}[^\\d]{0,15}${match[2]}|${match[2]}[^\\d]{0,15}${month}`, 'i').test(text))
}

export function experienceContentMatches(text: string, item: CvExperience): boolean {
  const actual = contentText(text).toLocaleLowerCase('ru')
  return [item.company, item.title, item.description, item.location].filter(Boolean)
    .every(value => actual.includes(contentText(value!).toLocaleLowerCase('ru'))) &&
    datePresent(actual, item.startDate) && datePresent(actual, item.endDate) &&
    (!item.current || /настояще|сейчас|present|current/i.test(actual))
}

export function educationContentMatches(text: string, item: CvEducation): boolean {
  const actual = contentText(text).toLocaleLowerCase('ru')
  return [item.institution, item.degree, item.specialization, item.description,
    item.graduationYear?.toString()].filter(Boolean)
    .every(value => actual.includes(contentText(value!).toLocaleLowerCase('ru')))
}
