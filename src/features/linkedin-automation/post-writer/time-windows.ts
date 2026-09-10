import { PostError } from './errors.ts'
export type TimeWindow = { start: string; end: string }
export const defaultWindows = (): TimeWindow[] => [{ start: '10:00', end: '15:00' }]
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)

export function validateWindows(value: unknown): TimeWindow[] {
  if (!Array.isArray(value) || value.length > 12) throw new PostError('post_intervals_invalid')
  const windows = value.map(item => {
    if (!item || !validTime(item.start) || !validTime(item.end) || item.start >= item.end) {
      throw new PostError('post_intervals_invalid')
    }
    return { start: item.start, end: item.end }
  }).sort((a, b) => a.start.localeCompare(b.start))
  if (windows.some((item, index) => index > 0 && windows[index - 1].end > item.start)) {
    throw new PostError('post_intervals_overlap_invalid')
  }
  return windows
}
export function dayWindows(date: string, windows = defaultWindows()) {
  return windows.map(item => ({ start: Date.parse(`${date}T${item.start}:00+03:00`),
    end: Date.parse(`${date}T${item.end}:00+03:00`) }))
}
export function randomWindowTime(date: string, windows: TimeWindow[], now: number, random: () => number) {
  const remaining = dayWindows(date, windows).map(item => ({ ...item, start: Math.max(now, item.start) }))
    .filter(item => item.end > item.start)
  const total = remaining.reduce((sum, item) => sum + item.end - item.start, 0)
  if (!total) return undefined
  let offset = Math.floor(Math.min(.999999, Math.max(0, random())) * total)
  for (const item of remaining) {
    if (offset < item.end - item.start) return item.start + offset
    offset -= item.end - item.start
  }
}
