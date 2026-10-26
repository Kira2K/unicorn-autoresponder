import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { deliver } from './delivery.mts';
import { tick } from './schedule.mts';
import { mondayAfter, WEEK } from './calendar.mts';

const OPEN = Date.parse('2026-10-22T14:00:00Z');
async function confirmWithoutDelivery(h: ReturnType<typeof harness>, actor = 'mentor') {
  const s = h.session(actor);
  return h.service.handle({ updateId: 900, username: actor, userId: 2, chatId: '-100',
    messageId: s.messageId, callback: 'm:' + s.id + ':' + s.revision + ':confirm' });
}

test('queued instruction, report and screen render the current name and mentor on every delivery attempt', async () => {
  const h = harness();
  await h.command('/hard_done', 'mentor'); await confirmWithoutDelivery(h);
  const audit = h.store.snapshot().history;
  await h.store.transaction(s => { Object.assign(s.clients['1'], {name: 'Новое имя', username: '@renamed', softMentor: '@replacement'}); });
  const first: string[] = [];
  await deliver({ store: h.store, now: h.now, send: async input => {
    first.push(input.text); return { kind: 'telegram-response', response: { ok: false, error_code: 429, description: 'slow', parameters:{retry_after:2} } };
  } });
  assert.ok(first.every(text => text.includes('Новое имя') && !text.includes('Тестовый ученик')));
  assert.ok(first.find(text => text.includes('с хардами'))?.includes('@replacement'));
  assert.ok(first.find(text => text.includes('Подтвердил:'))?.includes('Новое имя @renamed'));
  await h.store.transaction(s => { s.clients['1'].softMentor = '@newmentor'; s.clients['1'].username = '@newstudent'; });
  h.setNow(h.now() + 2000); await h.flush();
  const instruction = h.sent.find(m => m.text.includes('с хардами'))!;
  assert.match(instruction.text, /@newmentor/); assert.doesNotMatch(instruction.text, /@replacement|@softmentor/);
  const report = h.sent.find(m => m.chatId === '-900')!.text;
  assert.match(report, /@newmentor/);
  assert.match(report, /Новое имя @newstudent/);
  assert.doesNotMatch(report, /@renamed|@alice\b/);
  assert.deepEqual(h.store.snapshot().history, audit);
});

test('scheduled reports and reminders use current card fields with the original reporting period', async () => {
  for (const at of [mondayAfter(OPEN), OPEN + WEEK]) {
    const h = harness([fixtureClient({ status: 'on ru market' })]); h.setNow(at);
    await tick(h.store, at, '-900');
    await h.store.transaction(s => { Object.assign(s.clients['1'], { name: 'Новое имя', username: '@renamed', softMentor: '@replacement' }); });
    await h.flush();
    assert.ok(h.sent.every(m => m.text.includes('Новое имя') && !m.text.includes('Тестовый ученик')));
    const report = h.sent.find(m => m.chatId === '-900')!;
    assert.match(report.text, at === mondayAfter(OPEN) ? /@replacement/ : /@renamed/);
  }
});

test('a queued checkin report preserves its event answers and author after a later edit', async () => {
  const h = harness([fixtureClient({ status: 'on ru market' })]); h.setNow(OPEN);
  await h.command('/menu', 'mentor'); await h.click('checkin', 'mentor');
  await h.click('yes', 'mentor'); await h.click('confirm', 'mentor'); await h.click('no', 'mentor');
  await confirmWithoutDelivery(h);
  await h.store.transaction(s => {
    s.clients['1'].name = 'Новое имя';
    const ch = Object.values(s.checkins)[0];
    ch.result = { recruiters: false, interviews: true, actor: 'otherstaff', at: h.now() + 1 }; ch.version++;
  });
  await h.flush();
  const report = h.sent.find(m => m.chatId === '-900')!;
  assert.match(report.text, /Новое имя/);
  assert.match(report.text, /рекрутеров: Да/); assert.match(report.text, /собеседования: Нет/);
  assert.match(report.text, /Подтвердил: @mentor/); assert.doesNotMatch(report.text, /otherstaff/);
});
