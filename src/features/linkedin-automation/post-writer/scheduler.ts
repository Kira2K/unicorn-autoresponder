import { nextSlot, scheduledId, windowEnd } from './schedule.ts'
import { newRun, accountActive } from './run-actions.ts'
import type { Execution } from './execution-types.ts'
import type { PostRun, Settings } from './types.ts'
import { dayWindows } from './time-windows.ts'

type SchedulingExecution = Pick<Execution, 'now' | 'random' | 'writerId' | 'save' | 'saveSettings' | 'log'>
export async function schedulePosts(settings: Settings, runs: Map<string, PostRun>, e: SchedulingExecution) {
  let slot = settings.slot
  if (slot?.state === 'planned' && !runs.has(scheduledId(settings.account, slot.date)) && e.now() >= windowEnd(slot.date, settings)) {
    slot = { ...slot, state: 'missed' }
    settings = { ...settings, slot, lastMissedSlot: slot }
    await e.saveSettings(settings)
    e.log('schedule_missed', { account: settings.account, date: slot.date })
  }
  if (!settings.scheduled) return
  if (!slot || slot.state !== 'planned') {
    slot = nextSlot(settings, e.now(), e.random, date => runs.has(scheduledId(settings.account, date)))
    if (!slot) return
    settings = { ...settings, slot }
    await e.saveSettings(settings)
  }
  const id = scheduledId(settings.account, slot.date)
  if (!runs.has(id)) {
    if (slot.at > e.now() || !dayWindows(slot.date, settings.intervals)
      .some(window => e.now() >= window.start && e.now() < window.end)) return
    if (accountActive(runs.values(), settings.account)) return
    const run = newRun(id, settings.account, 'scheduled', 'automatic', settings.likes, e)
    run.memeEnabled = settings.memes === true
    if (settings.contentMode === 'prepared') {
      const post = settings.preparedPosts?.find(item => item.date === slot.date)
      if (!post) return
      run.preparedPost = { ...post }
      run.memeEnabled = true
    }
    await e.save(run)
    runs.set(id, run)
  }
  await e.saveSettings({ ...settings, slot: { ...slot, state: 'started' } })
}
