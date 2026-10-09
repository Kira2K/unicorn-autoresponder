import type { CvLanguage } from './types.ts'

const LEVELS = new Map([
  ['a1', 'A1'], ['a2', 'A2'], ['b1', 'B1'], ['b2', 'B2'],
  ['c1', 'C1'], ['c2', 'C2'], ['native', 'Native'], ['родной', 'Native']
])

const HH_LANGUAGE_NAMES = new Map([
  ['english', 'Английский'], ['английский', 'Английский'],
  ['russian', 'Русский'], ['русский', 'Русский'],
  ['georgian', 'Грузинский'], ['грузинский', 'Грузинский'],
  ['serbian', 'Сербский'], ['сербский', 'Сербский'],
  ['armenian', 'Армянский'], ['армянский', 'Армянский'],
  ['kazakh', 'Казахский'], ['казахский', 'Казахский']
])

function normalizedName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е')
}

function normalizedLevel(value: unknown): string | undefined {
  const text = String(value ?? '').trim().toLocaleLowerCase('ru-RU')
  const cefr = text.match(/\b([abc][12])\b/i)?.[1]?.toLowerCase()
  return LEVELS.get(cefr ?? text)
}

function isEnglish(value: unknown): boolean {
  return /^(?:english|английский)$/i.test(String(value ?? '').trim())
}

export function hhLanguageUiName(value: string): string {
  return HH_LANGUAGE_NAMES.get(normalizedName(value)) ?? value.trim()
}

export function resolveProfileLanguages(options: {
  cvLanguages: CvLanguage[]
  profileLanguage: 'ru' | 'en'
  databaseEnglishLevel?: string
}): CvLanguage[] {
  const result: CvLanguage[] = []
  const seen = new Set<string>()
  let english: CvLanguage | undefined
  for (const item of options.cvLanguages) {
    const name = item.name.trim()
    const level = normalizedLevel(item.level)
    if (!name) continue
    if (isEnglish(name)) {
      if (level && !english) english = { name, level }
      continue
    }
    if (!level) continue
    const key = normalizedName(name)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ name, level })
  }
  const fallbackEnglish = normalizedLevel(options.databaseEnglishLevel) ?? 'B2'
  const englishName = english?.name ?? (options.profileLanguage === 'ru' ? 'Английский' : 'English')
  return [{ name: englishName, level: english?.level ?? fallbackEnglish }, ...result]
}
