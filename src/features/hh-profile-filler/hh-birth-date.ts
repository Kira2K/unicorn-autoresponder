import type { Page } from 'playwright'

const months = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
export function normalizedBirthDate(value: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (!match) return undefined
  return match[1].length === 4 ? `${+match[3]}.${+match[2]}.${+match[1]}` : `${+match[1]}.${+match[2]}.${+match[3]}`
}

export async function readBirthDate(page: Page): Promise<string | undefined> {
  const day = page.locator('[data-qa="resume-profile-common-birthday-day-input"]')
  if (await day.isVisible().catch(() => false)) {
    const read = async (part: string) => {
      const locator = page.locator(`[data-qa="resume-profile-common-birthday-${part}-select"], [data-qa="resume-profile-common-birthday-${part}"]`).first()
      return (await locator.getAttribute('data-value') || await locator.innerText()).trim().toLowerCase()
    }
    const month = await read('month'), year = await read('year')
    const number = /^\d+$/.test(month) ? +month : months.findIndex(prefix => month.startsWith(prefix)) + 1
    if (!number || !/^\d{4}$/.test(year)) throw new Error('birth_date_unreadable')
    return `${Number(await day.inputValue())}.${number}.${+year}`
  }
  const input = page.locator('input[name="birthday"], input[name="birthDate"], [data-qa="resume-profile-common-birthday-input"]').first()
  if (await input.isVisible().catch(() => false)) return normalizedBirthDate(await input.inputValue())
  return undefined
}
