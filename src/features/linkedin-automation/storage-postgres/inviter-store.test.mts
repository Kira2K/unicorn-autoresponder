import assert from 'node:assert/strict';
import { test } from 'node:test';
import { featureFixture } from './fixture.mts';
import { createSqlInviterStore } from './inviter-store.mts';
import { makeRun } from '../connection-inviter/run-model.ts';
import type { ConnectionHistoryItem } from '../connection-inviter/types.ts';
test('SQL inviter reserves a run/history once, preserves recovery and never repeats unknown COMMIT', async () => {
  const f = featureFixture(), first = createSqlInviterStore(f.db, f.grant), second = createSqlInviterStore(f.db, f.grant);
  const run = makeRun({ platformAccountId: 21, clientId: 7, clientName: 'Test', accountId: 'fake',
    linkedinUrl: 'https://linkedin.com/in/test', stack: 'Go' }, new Date('2026-09-13T10:00:00Z'), 'Europe/Moscow', false);
  const created = await Promise.all([first.createRun(run), second.createRun(structuredClone(run))]);
  assert.equal(created.filter(r => r.created).length, 1);
  run.status = 'paused'; run.nextActionAt = '2026-09-14 10:00:00Z'; await first.updateRun(run);
  assert.equal((await second.getRun(run.runId))?.nextActionAt, run.nextActionAt);
  const item: ConnectionHistoryItem = { historyKey: 'fake:person', runId: run.runId, platformAccountId: 21,
    accountId: 'fake', personId: 'person', audience: 'technical', searchKey: 'go', name: 'Test',
    headline: 'Go Engineer', location: 'Remote', status: 'sending', discoveredAt: run.createdAt, updatedAt: run.createdAt };
  assert.deepEqual(await Promise.all([first.claimHistory(item), second.claimHistory(structuredClone(item))]), [true, false]);
  item.status = 'sent'; item.requestId = 'fake-request'; await first.updateHistory(item);
  assert.equal((await second.listOpenHistory(21))[0].requestId, 'fake-request');
  f.fail('commit');
  const unknown = { ...item, historyKey: 'fake:unknown', personId: 'unknown', status: 'sending' as const, requestId: undefined };
  await assert.rejects(first.claimHistory(unknown), /commit uncertain/); f.fail('');
  assert.equal(await createSqlInviterStore(f.db, f.grant).claimHistory(unknown), false);
  assert.equal((await first.findHistoryBatch('fake', ['person', 'person', 'unknown'])).length, 2);
  assert.deepEqual(await first.listRunsForAccount(22), []);
  assert.equal('getNocoBudget' in first, false);
});
