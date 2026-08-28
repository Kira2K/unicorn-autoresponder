import type { SearchAudience } from './catalog.ts'

const WEEKLY_LIMITS = [
  [1000, 40], [950, 38], [900, 36], [850, 33], [800, 31], [750, 29], [700, 27],
  [650, 24], [600, 22], [550, 20], [500, 18], [450, 17], [400, 15], [350, 13],
  [300, 11], [250, 10], [200, 8], [150, 7], [0, 5]
] as const

export const WEEKDAY_ORDER = [1, 3, 5, 2, 4] as const

export function weeklyInvitationLimit(connections: number): number {
  const normalized = Math.max(0, Math.floor(connections))
  return WEEKLY_LIMITS.find(([minimum]) => normalized >= minimum)?.[1] ?? 5
}

export function weekdayQuota(weekly: number, isoWeekday: number): number {
  if (isoWeekday < 1 || isoWeekday > 5) return 0
  const base = Math.floor(weekly / 5)
  const extra = weekly % 5
  return base + (WEEKDAY_ORDER.slice(0, extra).includes(isoWeekday as any) ? 1 : 0)
}

export function weeklyAudienceTargets(weekly: number): Record<SearchAudience, number> {
  const recruiter = Math.round(weekly * 0.7)
  return { recruiter, technical: weekly - recruiter }
}

export function buildWeeklyAudiencePlan(weekly: number): SearchAudience[] {
  const targets = weeklyAudienceTargets(weekly)
  const result: SearchAudience[] = []
  let recruiters = 0
  let technical = 0
  for (let index = 0; index < weekly; index += 1) {
    const recruiterGap = targets.recruiter - recruiters
    const technicalGap = targets.technical - technical
    const audience: SearchAudience = recruiterGap / Math.max(targets.recruiter, 1) >=
      technicalGap / Math.max(targets.technical, 1) ? 'recruiter' : 'technical'
    result.push(audience)
    if (audience === 'recruiter') recruiters += 1
    else technical += 1
  }
  return result
}

export function dailyAudienceQuota(weekly: number, isoWeekday: number): Record<SearchAudience, number> {
  const dayQuota = weekdayQuota(weekly, isoWeekday)
  if (!dayQuota) return { recruiter: 0, technical: 0 }
  let start = 0
  for (let day = 1; day < isoWeekday; day += 1) start += weekdayQuota(weekly, day)
  const slice = buildWeeklyAudiencePlan(weekly).slice(start, start + dayQuota)
  return {
    recruiter: slice.filter(value => value === 'recruiter').length,
    technical: slice.filter(value => value === 'technical').length
  }
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
