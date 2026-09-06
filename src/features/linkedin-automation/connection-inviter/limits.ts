import type { SearchAudience } from './catalog.ts'

const DAILY_LIMITS = [
  [1000, 40], [950, 38], [900, 36], [850, 33], [800, 31], [750, 29], [700, 27],
  [650, 24], [600, 22], [550, 20], [500, 18], [450, 17], [400, 15], [350, 13],
  [300, 11], [250, 10], [200, 8], [150, 7], [0, 5]
] as const

export function dailyInvitationLimit(connections: number): number {
  const normalized = Math.max(0, Math.floor(connections))
  return DAILY_LIMITS.find(([minimum]) => normalized >= minimum)?.[1] ?? 5
}

export function dailyAudienceTargets(dailyLimit: number): Record<SearchAudience, number> {
  const recruiter = Math.round(dailyLimit * 0.7)
  return { recruiter, technical: dailyLimit - recruiter }
}

export function connectionCount(value: any): number | undefined {
  const candidates = [value?.relations_count, value?.connections_count, value?.connection_count,
    value?.network_info?.connections_count]
  const parsed = candidates.map(Number).find(number => Number.isFinite(number) && number >= 0)
  return parsed === undefined ? undefined : Math.floor(parsed)
}

export function dateParts(now: Date, timeZone = 'Europe/Moscow') {
  const fields = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit',
    day: '2-digit', weekday: 'short' }).formatToParts(now)
  const value = Object.fromEntries(fields.map(field => [field.type, field.value]))
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const localDate = `${value.year}-${value.month}-${value.day}`
  const noon = new Date(`${localDate}T12:00:00Z`)
  const weekday = weekdays[value.weekday] ?? 7
  const monday = new Date(noon); monday.setUTCDate(noon.getUTCDate() - weekday + 1)
  return { localDate, isoWeekday: weekday, weekKey: monday.toISOString().slice(0, 10) }
}
