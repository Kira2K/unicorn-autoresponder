const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya'
}

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeLookupText(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/ё/g, 'е')
}

function slugify(value: unknown, fallback = 'unknown'): string {
  const normalized = normalizeLookupText(value)
  let slug = ''

  for (const char of normalized) {
    if (/[a-z0-9]/.test(char)) {
      slug += char
      continue
    }

    if (char === ' ') {
      slug += '_'
      continue
    }

    slug += CYRILLIC_TO_LATIN[char] ?? ''
  }

  return slug.replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 70) || fallback
}

function uniqueValue(baseValue: string, usedValues: Set<string>): string {
  let candidate = baseValue
  let index = 2
  while (usedValues.has(candidate)) {
    candidate = `${baseValue}_${index}`
    index += 1
  }
  usedValues.add(candidate)
  return candidate
}

module.exports = {
  CYRILLIC_TO_LATIN,
  normalizeLookupText,
  normalizeText,
  slugify,
  uniqueValue
}
