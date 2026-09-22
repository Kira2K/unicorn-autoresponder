import { test } from 'node:test'
import assert from 'node:assert/strict'
import { automationOverview, automationToggleItems, latestRuns } from './linkedin-automation-view.js'

const now = 100000
const setting = { account: 2, enabled: true, revision: 4, slots: [{ id: 'slot', features: ['posts', 'comments'] }] }
const snapshot = { settings: [setting], preview: [] }
const run = (key, state, updatedAt, extra = {}) => ({ key, state, updatedAt, account: 2, feature: 'posts', slotId: 'slot', plannedAt: now + 500, closesAt: now + 5000, ...extra })

test('unconfirmed result stays visible despite future planned runs and disabled scheduling', () => {
  const blocked = run('uncertain', 'blocked', now - 100, { description: 'Проверяется результат' })
  const diagnostics = { runs: [blocked, run('tomorrow', 'planned', now + 100)] }
  assert.equal(automationOverview(2, snapshot, diagnostics, now).run.key, 'uncertain')
  const off = automationOverview(2, { settings: [{ ...setting, enabled: false }] }, diagnostics, now)
  assert.equal(off.attention, true)
  assert.equal(off.next, 'Автоматизация выключена')
  assert.equal(off.upcoming.length, 0)
})

test('completed recovery supersedes an old problem, other students do not enter the summary', () => {
  const diagnostics = { runs: [run('old', 'blocked', 10), run('new', 'completed', 20), run('other', 'blocked', 30, { account: 3 })] }
  const view = automationOverview(2, snapshot, diagnostics, now)
  assert.equal(view.attention, false)
  assert.equal(view.run.key, 'new')
})

test('next actual execution is ordered by planned time; expired slots are excluded', () => {
  const diagnostics = { runs: [run('later', 'planned', 10, { plannedAt: now + 900 }), run('sooner', 'planned', 20), run('expired', 'planned', 30, { plannedAt: 10, closesAt: 50 })] }
  const view = automationOverview(2, snapshot, diagnostics, now)
  assert.equal(view.upcoming[0].key, 'sooner')
  assert.equal(view.upcoming.length, 2)
  assert.equal(latestRuns(diagnostics.runs)[0].key, 'expired')
})

test('switching automation preserves each selected schedule and optimistic revision', () => {
  const second = { ...setting, account: 3, revision: 8, slots: [{ id: 'other', features: ['invitations'] }] }
  const items = automationToggleItems([2, 3], [setting, second], false)
  assert.deepEqual(items.map(i => i.revision), [4, 8])
  assert.deepEqual(items[0].settings.slots, setting.slots)
  assert.deepEqual(items[1].settings.slots, second.slots)
  assert.ok(items.every(i => i.settings.enabled === false))
  assert.equal(setting.enabled, true)
})

test('missing schedule requires setup, stopping runs remain visible after switch-off', () => {
  assert.equal(automationOverview(9, snapshot, {}, now).next, 'Расписание не задано')
  const off = automationOverview(2, { settings: [{ ...setting, enabled: false }] }, { runs: [run('stopping', 'running', now, { stopRequested: true })] }, now)
  assert.equal(off.active, true)
  assert.match(off.current, /Остановка/)
})

test('replaced schedule does not display a stale next execution before the next backend tick', () => {
  const view = automationOverview(2, snapshot, { runs: [run('old-slot', 'planned', 100, { slotId: 'removed' })] }, now)
  assert.equal(view.upcoming.length, 0)
  assert.equal(view.next, 'Ожидает планирования')
})

test('background comment waiting remains visible without a fake expired slot or random start time',()=>{
  const pending=run('monitor','planned',now,{feature:'comments',commentMode:'continuous',slotId:'continuous',
    closesAt:now-1,description:'Комментарии ждут подтверждённой публикации первого поста.'})
  const view=automationOverview(2,snapshot,{runs:[pending]},now)
  assert.equal(view.run.key,'monitor');assert.match(view.description,/ждут/);assert.equal(view.upcoming.length,0)
})
