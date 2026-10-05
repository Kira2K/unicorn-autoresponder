import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scheduleDraft, schedulePayload, scheduleError, timeMinutes, dateMsk, accountSummary, apiError, reasonText, isErrorEvent, canResumeTask } from './linkedin-automation-view.js'
test('continuation is offered for every unfinished feature today, only while its original budget allows it', () => {
  const now = Date.parse('2026-10-03T10:00:00+03:00')
  const schedule = { enabled: true, slots: [{ features: ['invitations', 'posts', 'comments', 'withdrawals'] }] }
  for (const feature of schedule.slots[0].features) {
    const task = { feature, day: '2026-10-03', state: 'stopped', activeMs: 20, activeLimitMs: 100, deadlineAt: now + 1000 }
    assert.equal(canResumeTask(task, schedule, now), true)
    assert.equal(canResumeTask({ ...task, stopped: true, state: 'verifying' }, schedule, now), true)
    for (const patch of [{ day: '2026-10-02' }, { state: 'completed' }, { deadlineAt: now }, { activeMs: 100 }])
      assert.equal(canResumeTask({ ...task, ...patch }, schedule, now), false)
    assert.equal(canResumeTask(task, { ...schedule, enabled: false }, now), false)
  }
})
test('calendar roundtrip preserves midnight, feature choices and version without mutating input', () => {
  const saved = { enabled: true, version: 3, postPolicy: { contentMode: 'prepared', generateIfMissing: true },
    slots: [{ id: 'night', day: 0, start: 1380, end: 1440, features: ['posts'] }] }
  const draft = scheduleDraft(saved)
  assert.equal(scheduleError(draft), '')
  assert.deepEqual(schedulePayload(draft), saved)
  draft.slots[0].features.push('comments')
  assert.deepEqual(saved.slots[0].features, ['posts'])
  assert.ok(Number.isNaN(timeMinutes('12')))
  assert.ok(Number.isNaN(timeMinutes('24:01')))
  assert.match(dateMsk(Date.parse('2026-09-28T23:30:00Z')), /29\.09.*02:30/)
})
test('invalid partial hours, empty features, overlap and overnight intervals produce plain Russian errors', () => {
  const draft = { enabled: true, version: 0, slots: [{ id: 'a', day: 1, start: '10:00', end: '12', features: ['posts'] }] }
  assert.match(scheduleError(draft), /полное время/)
  draft.slots[0].end = '09:00'; assert.match(scheduleError(draft), /Ночной/)
  draft.slots[0].end = '12:00'; draft.slots.push({ ...draft.slots[0], id: 'b' })
  assert.match(scheduleError(draft), /Пересекаются/)
  draft.slots.pop(); draft.slots[0].features = []; assert.match(scheduleError(draft), /фичу/)
  assert.match(scheduleError({ enabled: true, slots: [] }), /интервал/)
})
test('student summary separates a current action from an old result and another student', () => {
  const account = { platformAccountId: 7, state: 'connected' }
  const task = { account: { id: 7 }, nextAt: 100, updatedAt: 1 }
  const summary = accountSummary(account, { tasks: [{ ...task, id: 'done', state: 'completed' },
    { ...task, id: 'wait', state: 'waiting' }, { ...task, id: 'other', state: 'running', account: { id: 8 } }] })
  assert.equal(summary.current.id, 'wait'); assert.equal(summary.last.id, 'done')
  assert.match(apiError({ body: { code: 'automation_version_conflict' } }), /другом окне/)
})

test('saved progress and ordinary pacing are not presented as failures', () => {
  for (const code of ['history_and_quota_saved', 'candidate_page_saved', 'candidate_result_saved',
    'candidate_skipped', 'withdrawal_saved', 'saved_pause', 'withdrawal_pacing', 'session_limit', 'session_finished']) {
    assert.doesNotMatch(reasonText(code), /Нужна проверка|Ожидаем снятия ограничения Unipile/)
    assert.equal(isErrorEvent({ code }), false)
  }
  assert.match(reasonText('unipile_shared_cooldown'), /ограничения Unipile/)
  assert.equal(isErrorEvent({ code: 'unipile_error', httpStatus: 500 }), true)
  assert.equal(isErrorEvent({ code: 'unipile_action_skipped' }), true)
  assert.equal(isErrorEvent({ code: 'comments_post_skipped' }), true)
})

test('missed comment monitoring is visible as an error with a Russian explanation', () => {
  assert.match(reasonText('comments_post_not_published'), /пост не опубликован/)
  assert.match(reasonText('comments_not_started'), /не запускался/)
  assert.equal(isErrorEvent({ code: 'comments_post_not_published' }), true)
  assert.equal(isErrorEvent({ code: 'comments_not_started' }), true)
})
