import { enabledFor, type AutomationSettings, type AutomationRun } from './contracts.ts'
import { localDate } from './calendar.ts'

// No IO: the scheduler and every automatic comment write use the same calendar/priority rule.
// After the first verified post, the monitor continues on all active weekdays, including days without posts.
export function commentWaitReason(config: AutomationSettings | undefined, runs: AutomationRun[],
  monitor: AutomationRun, now: number): string | undefined {
  if (!enabledFor(config, 'comments')) return 'automation_disabled'
  const date = localDate(now), weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7
  if (!config!.slots.some(s => s.day === weekday)) return 'automation_comments_inactive_day'
  const accountRuns = runs.filter(r => r.account === monitor.account)
  if (!monitor.featureRunId && enabledFor(config, 'posts')) {
    const since = Math.min(monitor.opensAt, Date.parse(`${date}T00:00:00+03:00`))
    if (!accountRuns.some(r => r.feature === 'posts' && r.publication?.id &&
      r.publication.at >= since && r.publication.at <= now)) return 'automation_comments_waiting_for_post'
  }
  if (accountRuns.some(r => r.feature !== 'comments' && (
    ['starting','running'].includes(r.state) ||
    (r.state === 'planned' && enabledFor(config, r.feature) && r.opensAt <= now &&
      r.plannedAt <= now && r.closesAt > now)))) return 'automation_comments_yielding'
}
