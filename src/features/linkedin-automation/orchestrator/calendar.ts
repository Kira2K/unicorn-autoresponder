import { features, automationError, type AutomationSettings, type Feature, type WeekSlot } from './contracts.ts'
const MINUTE = 60_000, DAY = 86400_000, OFFSET = 3 * 3600_000
export const initialMinutes: Record<Feature, number> = { invitations: 180, posts: 30, withdrawals: 20, comments: 5 }
export function reservedTime(feature: Feature, estimate = 0, samples: number[] = []) {
  const recent = samples.slice(0, 20).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
  const p90 = recent[Math.max(0, Math.ceil(recent.length * .9) - 1)] ?? 0
  return Math.ceil(Math.max(initialMinutes[feature] * MINUTE, estimate, p90) * 1.3 + 10 * MINUTE)
}
export function validateSettings(account: number, input: unknown, revision: number, now: number): AutomationSettings {
  const x = input as Partial<AutomationSettings>
  if (!Number.isSafeInteger(account) || account <= 0 || !x || typeof x.enabled !== 'boolean' ||
    x.timezone !== 'Europe/Moscow' || !Array.isArray(x.slots) || x.slots.length > 84)
    throw automationError('automation_settings_invalid')
  const ids = new Set<string>()
  const time = (s: unknown) => typeof s === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)
  const slots = x.slots.map((slot): WeekSlot => {
    if (!slot || typeof slot.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(slot.id) || ids.has(slot.id) ||
      !Number.isInteger(slot.day) || slot.day < 1 || slot.day > 7 || !time(slot.start) ||
      !(time(slot.end) || slot.end === '24:00') || slot.start >= slot.end || !Array.isArray(slot.features) ||
      !slot.features.length || slot.features.some(f => !features.includes(f)) || new Set(slot.features).size !== slot.features.length)
      throw automationError('automation_slot_invalid')
    ids.add(slot.id)
    return { id: slot.id, day: slot.day, start: slot.start, end: slot.end, features: [...slot.features] }
  }).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
  if (slots.some((s, i) => i > 0 && slots[i - 1].day === s.day && slots[i - 1].end > s.start))
    throw automationError('automation_slots_overlap')
  if (x.enabled && !slots.length) throw automationError('automation_slots_required')
  return { account, enabled: x.enabled, revision: revision + 1, timezone: 'Europe/Moscow', slots, updatedAt: now }
}
export function localDate(now: number) { return new Date(now + OFFSET).toISOString().slice(0, 10) }
export function windows(settings: AutomationSettings, now: number, days = 8) {
  const dayStart = Date.parse(`${localDate(now)}T00:00:00+03:00`)
  const result: Array<{ date: string; slot: WeekSlot; start: number; end: number }> = []
  for (let i = 0; i < days; i++) {
    const start = dayStart + i * DAY, date = localDate(start)
    const weekday = new Date(start + OFFSET).getUTCDay() || 7
    for (const slot of settings.slots.filter(s => s.day === weekday)) {
      const at = (t: string) => start + (Number(t.slice(0, 2)) * 60 + Number(t.slice(3))) * MINUTE
      if (at(slot.end) > now) result.push({ date, slot, start: at(slot.start), end: at(slot.end) })
    }
  }
  return result
}
export const occurrenceKey = (account: number, feature: Feature, date: string, slot: WeekSlot) =>
  `${account}:${feature}:${date}:${slot.start}`
export function planTime(start: number, end: number, reserve: number, now: number, random: () => number) {
  const earliest = Math.max(start, now), latest = end - reserve
  return latest < earliest ? undefined : earliest + Math.floor(Math.max(0, Math.min(.999999, random())) * (latest - earliest))
}
