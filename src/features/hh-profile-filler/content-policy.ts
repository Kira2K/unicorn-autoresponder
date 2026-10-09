import type { CvExperience, CvEducation } from './types.ts'
import { educationDegreeMatches } from './education-policy.ts'

export function contentText(value: string): string {
  return value.normalize('NFKC').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim()
}

const months = [
  ['январ', 'january'], ['феврал', 'february'], ['март', 'march'], ['апрел', 'april'],
  ['мая', 'май', 'may'], ['июн', 'june'], ['июл', 'july'], ['август', 'august'],
  ['сентябр', 'september'], ['октябр', 'october'], ['ноябр', 'november'], ['декабр', 'december']
]
export function datePresent(text: string, date?: string): boolean {
  if (!date) return true
  if (/^(?:present|current|now|сейчас|по настоящее время)$/i.test(date.trim())) {
    return /настояще|сейчас|present|current|\bnow\b/i.test(text)
  }
  if (text.includes(date)) return true
  const match = date.match(/^(\d{1,2})\/(\d{4})$/) ?? date.match(/^(\d{1,2})\.(\d{4})$/)
  if (!match) return false
  return (months[Number(match[1]) - 1] ?? []).some(month =>
    new RegExp(`${month}[^\\d]{0,15}${match[2]}|${match[2]}[^\\d]{0,15}${month}`, 'i').test(text))
}

export function experienceContentMatches(text: string, item: CvExperience): boolean {
  return experienceContentDifferences(text, item).length === 0
}

export function experienceContentDifferences(text: string, item: CvExperience): string[] {
  const prose = (value: string) => contentText(value).toLocaleLowerCase('ru')
    .replace(/(?:^|\s)[●•▪◦]\s*/g, ' ')
    .replace(/(?:^|\s)[*-]\s+(?=\p{L})/gu, ' ').replace(/\s+/g, ' ').trim()
  const actual = prose(text)
  const differences: string[] = []
  for (const field of ['company', 'title', 'description', 'location'] as const) {
    if (item[field] && !actual.includes(prose(item[field]!))) differences.push(field)
  }
  if (!datePresent(actual, item.startDate)) differences.push('startDate')
  if (!datePresent(actual, item.endDate)) differences.push('endDate')
  if (item.current && !/настояще|сейчас|present|current/i.test(actual)) differences.push('current')
  return differences
}

export function educationContentMatches(text: string, item: CvEducation): boolean {
  return educationContentDifferences(text, item).length === 0
}

export function educationContentDifferences(text: string, item: CvEducation): string[] {
  const actual = contentText(text).toLocaleLowerCase('ru')
  const differences = educationDegreeMatches(actual, item.degree) ? [] : ['degree']
  for (const field of ['institution', 'specialization', 'description', 'graduationYear'] as const) {
    const expected = item[field]
    if (expected && !actual.includes(contentText(String(expected)).toLocaleLowerCase('ru'))) differences.push(field)
  }
  return differences
}
