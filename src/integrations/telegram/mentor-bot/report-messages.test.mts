import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './test-harness.mts';
import { fixtureClient } from './test-fixtures.mts';
import { renderDelivery, type MessageTemplate } from './message-templates.mts';

test('all student reports put the current normalized student tag after every occurrence of their name', () => {
  const h = harness(), state = h.store.snapshot();
  state.clients['1'].username = '@RENAMED';
  const checkin = { id: 'test', clientId: '1', start: h.now(), end: h.now(), closesAt: h.now() + 1,
    state: 'open' as const, version: 1,
    result: { recruiters: false, interviews: false, actor: 'mentor', at: h.now() } };
  const templates: MessageTemplate[] = [
    { type: 'hard-report', actor: 'mentor' }, { type: 'ready-report', actor: 'mentor', repeat: false },
    { type: 'ready-revoked', actor: 'mentor' },
    { type: 'mentor-report', mentorType: 'soft', before: '@oldmentor', after: '@newmentor', actor: 'mentor' },
    { type: 'market-report', market: 'ru', actor: 'mentor' }, { type: 'responses-report', market: 'РУ', actor: 'mentor' },
    { type: 'checkin-report', checkin },
    { type: 'checkin-report', checkin, before: { ...checkin.result, recruiters: true } },
    { type: 'monday-report' }, { type: 'miss-report', start: h.now(), end: h.now(), recruiterMisses: 2, interviewMisses: 2 },
    { type: 'pitch-report', days: 7 }, { type: 'stage-unmapped', status: 'test' }
  ];
  for (const chatId of ['-900', '-100']) {
    for (const template of templates) {
      const message = renderDelivery(state, { id: 'report', clientId: '1', kind: 'report', template,
        input: { chatId, text: '' }, state: 'pending', attempts: 0, retryAt: h.now() });
      const occurrences = message.text.split(state.clients['1'].name);
      assert.ok(occurrences.length > 1, template.type);
      assert.ok(occurrences.slice(1).every(part => part.startsWith(' @renamed')), template.type);
      assert.doesNotMatch(message.text, /@alice\b|@RENAMED\b/);
      assert.equal(message.chatId, chatId);
    }
  }
});

test('reports without a valid student username keep the name without a fabricated tag', () => {
  for (const username of ['', 'invalid username']) {
    const h = harness([fixtureClient({ username })]), state = h.store.snapshot();
    const message = renderDelivery(state, { id: 'report', clientId: '1', kind: 'report',
      template: { type: 'pitch-report', days: 7 }, input: { chatId: '-900', text: '' },
      state: 'pending', attempts: 0, retryAt: h.now() });
    assert.ok(message.text.startsWith(state.clients['1'].name + ' '));
    assert.doesNotMatch(message.text, /@|undefined|null/);
  }
});
