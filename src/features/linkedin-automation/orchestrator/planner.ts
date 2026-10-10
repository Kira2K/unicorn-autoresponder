import { features, fail, terminal, type Feature, type Schedule, type Task } from './contracts.ts'
import { AUTOMATIC_RUN_MAX_AGE_MS } from '../execution-step.ts'

const minute = 60_000, day = 86_400_000, moscow = 3 * 60 * minute
export const unknownLockGraceMs = 10 * minute
const initial: Record<Feature, number> = { invitations: 180 * minute, posts: 30 * minute,
  withdrawals: 20 * minute, comments: 5 * minute }
export const dateMsk = (now: number) => new Date(now + moscow).toISOString().slice(0, 10)
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00+03:00`)
export const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7

export function validateSchedule(value: Schedule) {
  if (!value || !Number.isSafeInteger(value.account?.id) || value.account.id <= 0 ||
    !value.account.key || !value.account.unipileId || typeof value.enabled !== 'boolean' ||
    !Array.isArray(value.slots) || value.slots.length > 70) throw fail('automation_schedule_invalid', 'Некорректное расписание.')
  const ids = new Set<string>()
  if (value.postPolicy !== undefined && (!value.postPolicy ||
    !['generated', 'prepared'].includes(value.postPolicy.contentMode) || typeof value.postPolicy.generateIfMissing !== 'boolean'))
    throw fail('automation_post_policy_invalid', 'Выберите источник постов и действие при отсутствии текста.')
  for (const slot of value.slots) {
    if (!slot || typeof slot.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(slot.id) || ids.has(slot.id) ||
      !Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6 ||
      !Number.isInteger(slot.start) || !Number.isInteger(slot.end) ||
      slot.start < 0 || slot.start >= slot.end || slot.end > 1440 ||
      !Array.isArray(slot.features) || !slot.features.length ||
      new Set(slot.features).size !== slot.features.length || slot.features.some(f => !features.includes(f)))
      throw fail('automation_slot_invalid', 'Проверьте день, время и фичи слота. Ночной интервал разделите на два.')
    ids.add(slot.id)
  }
  for (let d = 0; d < 7; d++) {
    const slots = value.slots.filter(s => s.day === d).sort((a, b) => a.start - b.start)
    if (slots.some((s, i) => i > 0 && s.start < slots[i - 1].end))
      throw fail('automation_slots_overlap', 'Слоты одного дня пересекаются.')
  }
  return value
}
export function reserve(feature: Feature, estimate = 0, durations: number[] = []) {
  const sorted = durations.filter(n => Number.isFinite(n) && n >= 0).slice(-20).sort((a, b) => a - b)
  const p90 = sorted[Math.max(0, Math.ceil(sorted.length * .9) - 1)] ?? 0
  return Math.ceil(Math.max(initial[feature], estimate, p90) * 1.3 + 10 * minute)
}
export function windowFor(schedule: Schedule, feature: Feature, now: number, continuing = false) {
  for (let offset = 0; offset < 8; offset++) {
    const date = dateMsk(now + offset * day), start = dayStart(date)
    const slots = schedule.slots.filter(s => s.day === weekday(date) &&
      (feature === 'comments' && continuing || s.features.includes(feature))).sort((a, b) => a.start - b.start)
    if (feature === 'comments' && continuing && schedule.slots.some(s => s.features.includes('comments')) && slots.length)
      return { start: Math.max(start, now), end: start + day }
    for (const slot of slots) if (start + slot.end * minute > now)
      return { start: Math.max(now, start + slot.start * minute), end: start + slot.end * minute }
  }
}

/** A saved plan is never re-randomized by a tick. Version changes do not change daily keys. */
export function plan(schedule: Schedule, previous: Task[], now: number, random: () => number): Task[] {
  validateSchedule(schedule)
  if (!schedule.enabled) return []
  const date = dateMsk(now), midnight = dayStart(date), today = weekday(date)
  const known = new Set(previous.map(t => t.id)), result: Task[] = []
  const slots = schedule.slots.filter(s => s.day === today && midnight + s.end * minute > now)
    .sort((a, b) => a.start - b.start)
  for (const slot of slots) {
    const actionable = slot.features.filter(f => f !== 'comments')
      .sort((a, b) => Number(a === 'withdrawals') - Number(b === 'withdrawals'))
    const start = Math.max(now, midnight + slot.start * minute), end = midnight + slot.end * minute
    // Stratified random starts spread features through the entire available interval.
    for (const [index, feature] of actionable.entries()) {
      const id = `${schedule.account.key}:${date}:${feature}:${feature === 'withdrawals' ? slot.id : 'daily'}`
      if (known.has(id)) continue
      const span = (end - start) / Math.max(1, actionable.length)
      const at = Math.min(end - 1, Math.floor(start + span * (index + Math.min(.999999, Math.max(0, random())))))
      result.push(make(id, feature, slot.id, at, end)); known.add(id)
    }
  }
  // A daily task links to a persistent 48-hour session; it does not create another session at the limit.
  const commentSlot = slots.find(s => s.features.includes('comments'))
  if (commentSlot) {
    const id = `${schedule.account.key}:${date}:comments:daily`
    if (!known.has(id)) result.push(make(id, 'comments', 'active-day',
      Math.max(now, midnight + commentSlot.start * minute), midnight + day))
  }
  return result

  function make(id: string, feature: Feature, slotId: string, at: number, end: number): Task {
    return { id, account: { ...schedule.account }, feature, day: date, slotId,
      scheduleVersion: schedule.version, plannedAt: at, nextAt: at, windowEnd: end, postPolicy: schedule.postPolicy,
      state: 'planned', createdAt: now, updatedAt: now, activeMs: 0,
      activeLimitMs: Math.min(12 * 60 * minute, Math.max(15 * minute, 2 * reserve(feature))),
      elapsedLimitMs: AUTOMATIC_RUN_MAX_AGE_MS, attempts: 0, version: 0 }
  }
}

export function canRunBesideUnknown(task: Pick<Task, 'id' | 'account'> & { day?: string; feature: Feature | 'likes' }, pending: Task, now: number) {
  if (pending.id === task.id || terminal(pending) || pending.account.key !== task.account.key) return true
  if (pending.state !== 'verifying') return true
  // In-flight steps are serialized separately. A saved unknown result only
  // prevents conflicting operations, without a blanket account-wide grace lock.
  const connections = (f: string) => f === 'invitations' || f === 'withdrawals'
  if (task.feature === 'likes') return true // Its actor + post intent protects the individual reaction.
  // Same-feature recovery still owns its run. Withdrawal protects possible
  // unknown recipients inside its approved queue; unrelated old requests can proceed.
  if (connections(pending.feature)) return task.feature !== pending.feature ||
    (pending.feature === 'invitations' && !!task.day && task.day > pending.day)
  if (pending.feature === 'posts') return connections(task.feature) ||
    (task.day !== pending.day && ['posts', 'comments'].includes(task.feature))
  return task.feature !== pending.feature || (!!task.day && task.day > pending.day)
}
