import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendResumeRejectionHistory, activeResumeRejection } from './resume-rejection-history.ts';

const comment = 'Уточнить <опыт> & даты';
const event = {
  at: '2026-10-12T00:00:00.000Z', fromStatus: 'Russian version in approve by Kira',
  toStatus: 'Russian version in process', actor: 'kira user:9002', comment,
  returnedCvUrl: 'https://example.invalid/rejected?x=1&y=2'
};
const record = (rejectionHistory: string, status = 'Russian version in process', lastRejectionComment = comment) =>
  ({ status, lastRejectionComment, rejectionHistory });

test('JSON history preserves the old text verbatim and safely round-trips a return', () => {
  const previous = '  old text with trailing spaces  \n';
  const history = appendResumeRejectionHistory(previous, event);
  assert.ok(history.startsWith(previous));
  const saved = JSON.parse(history.slice(previous.length));
  assert.equal(saved.stage, 'ru');
  assert.equal(saved.comment, comment);
  assert.equal(saved.returnedCvUrl, event.returnedCvUrl);
  for (const status of ['Russian version in process', 'Russian version in approve by Kira', 'Russian version in approve by student']) {
    assert.deepEqual(activeResumeRejection(record(history, status)), { comment, returnedCvUrl: event.returnedCvUrl });
  }
});

test('resolved or different-stage returns do not appear as current context', () => {
  const history = appendResumeRejectionHistory('', event);
  for (const status of ['Draft in process', 'English version in progress', 'moved to filling', 'filled'])
    assert.equal(activeResumeRejection(record(history, status)), null);
  assert.equal(activeResumeRejection(record(history, 'Russian version in process', '')), null);
});

test('legacy text retains the saved comment but cannot invent a missing returned URL', () => {
  const history = '2026-01-01T00:00:00.000Z Draft in approve by student -> Draft in process by student user:123: Старый комментарий';
  assert.deepEqual(activeResumeRejection(record(history, 'Draft in process')), { comment, returnedCvUrl: '' });
  assert.equal(activeResumeRejection(record(history)), null, 'do not carry a legacy draft return into RU');
  assert.deepEqual(activeResumeRejection(record('')), { comment, returnedCvUrl: '' });
});

test('a newer empty, mismatched or invalid entry never resurrects an earlier URL', () => {
  const history = appendResumeRejectionHistory('', event);
  const blank = appendResumeRejectionHistory(history, { ...event, returnedCvUrl: '' });
  assert.deepEqual(activeResumeRejection(record(blank)), { comment, returnedCvUrl: '' });
  const otherComment = appendResumeRejectionHistory(history, { ...event, comment: 'Другая причина' });
  assert.deepEqual(activeResumeRejection(record(otherComment)), { comment, returnedCvUrl: '' });
  for (const lastLine of ['{broken', '{"version":99}', 'unknown legacy data'])
    assert.deepEqual(activeResumeRejection(record(history + '\n' + lastLine)), { comment, returnedCvUrl: '' });
  const invalidUrl = appendResumeRejectionHistory('', { ...event, returnedCvUrl: 'javascript:alert(1)' });
  assert.deepEqual(activeResumeRejection(record(invalidUrl)), { comment, returnedCvUrl: '' });
});
