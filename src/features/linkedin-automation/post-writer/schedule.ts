import { PostError } from './errors.ts'
import type { Settings, Slot } from './types.ts'
import { defaultWindows, dayWindows, randomWindowTime, validateWindows } from './time-windows.ts'
import { topicList } from './content-rules.ts'
import { validatePreparedPosts } from './prepared-posts.ts'

const DAY = 86_400_000
export const moscowDate = (now: number) => new Date(now + 3 * 3_600_000).toISOString().slice(0, 10)
export const windowEnd = (date: string, settings?: Settings) =>
  Math.max(0, ...dayWindows(date, settings?.intervals).map(item => item.end))
export const scheduledId = (account: number, date: string) => `scheduled-${account}-${date}`

export function nextSlot(settings: Settings, now: number, random: () => number): Slot | undefined {
  if (!settings.scheduled) return undefined
  const today = moscowDate(now)
  const prepared = settings.contentMode === 'prepared'
  const dates = prepared ? validatePreparedPosts(settings.preparedPosts ?? []).map(item => item.date) :
    Array.from({ length: 8 }, (_, offset) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY).toISOString().slice(0, 10))
  for (const date of dates) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7
    if ((!prepared && !settings.days.includes(weekday)) || windowEnd(date, settings) <= now) continue
    if (date === settings.slot?.date) {
      if (settings.slot.state === 'planned') return settings.slot
      if (settings.slot.state !== 'cancelled') continue
    }
    const at = randomWindowTime(date, settings.intervals ?? defaultWindows(), now, random)
    if (at !== undefined) return { date, at, state: 'planned' }
  }
}

export function validateSettings(input: unknown, previous: Settings): Settings {
  const value = input as Partial<Settings>
  const contentMode = value?.contentMode ?? previous.contentMode ?? 'generated'
  if (!value || typeof value.scheduled !== 'boolean' || typeof value.likes !== 'boolean' ||
    !['approval_required', 'automatic'].includes(String(value.manualMode)) ||
    !Array.isArray(value.days) || value.days.some(day => !Number.isInteger(day) || day < 1 || day > 7) ||
    (value.memes !== undefined && typeof value.memes !== 'boolean') ||
    !['generated', 'prepared'].includes(contentMode) ||
    (value.scheduled && contentMode === 'generated' && !value.days.length)) throw new PostError('post_settings_invalid')
  const result = { ...previous, scheduled: value.scheduled, likes: value.likes, memes: value.memes ?? previous.memes ?? false,
    manualMode: value.manualMode!, days: [...new Set(value.days)].sort(),
    intervals: validateWindows(value.intervals ?? previous.intervals ?? defaultWindows()),
    forbiddenTopics: topicList(value.forbiddenTopics ?? previous.forbiddenTopics ?? []),
    contentMode, preparedPosts: validatePreparedPosts(value.preparedPosts ?? previous.preparedPosts ?? []) }
  if (result.scheduled && !result.intervals.length) throw new PostError('post_intervals_invalid')
  if (result.slot?.state === 'planned') {
    const weekday = new Date(`${result.slot.date}T12:00:00Z`).getUTCDay() || 7
    if (!result.scheduled || (contentMode === 'prepared'
      ? !result.preparedPosts.some(item => item.date === result.slot!.date) : !result.days.includes(weekday)) ||
      contentMode !== (previous.contentMode ?? 'generated') ||
      JSON.stringify(result.intervals) !== JSON.stringify(previous.intervals ?? defaultWindows()) ||
      JSON.stringify(result.days) !== JSON.stringify(previous.days)) {
      result.slot = { ...result.slot, state: 'cancelled' }
    }
  }
  return result
}
