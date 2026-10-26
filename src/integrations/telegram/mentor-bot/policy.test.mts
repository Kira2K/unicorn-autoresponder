import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowed, authorize, username, weeks } from './policy.mts';
import { nextThursday, mondayAfter } from './calendar.mts';
import { emptyState } from './types.mts';
import { fixtureClient, fixtureLearner } from './test-fixtures.mts';
test('username roles are global, case insensitive, fail closed on missing and ambiguous identities', () => {
  const s = emptyState([fixtureClient(), fixtureClient({ id: '2', username: '@second', chatId: '-200' })]);
  s.learners['1'] = fixtureLearner();
  assert.equal(username(' @@Alice '), '');
  assert.equal(authorize(s, '-100', '@ALICE')?.role, 'student');
  assert.equal(authorize(s, '-100', '@mentor')?.role, 'staff');
  assert.equal(authorize(s, '-100', '@second'), null);
  assert.equal(authorize(s, '-100', ''), null);
  s.clients['2'].username = '@alice';
  assert.equal(authorize(s, '-100', '@alice'), null);
  s.clients['2'].chatId = '-100';
  assert.equal(authorize(s, '-100', '@mentor'), null);
  assert.equal(allowed('student', 'hard'), false);
});
test('Moscow boundaries are independent of host timezone', () => {
  const thursday = Date.parse('2026-10-22T14:00:00Z');
  assert.equal(nextThursday(thursday), thursday);
  assert.equal(nextThursday(thursday + 1), Date.parse('2026-10-29T14:00:00Z'));
  assert.equal(mondayAfter(thursday), Date.parse('2026-10-26T09:00:00Z'));
});
test('Russian week declension', () => {
  assert.deepEqual([1,2,5,11,14,21,22,25,101,111].map(weeks),
    ['неделю','недели','недель','недель','недель','неделю','недели','недель','неделю','недель']);
});
