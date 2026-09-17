import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedInFixture, authHistoryId } from './linkedin-fixture.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import { linkedInWrites } from './linkedin-writes.mts';
import { tableIds as t } from './tables.mts';
import type { LinkedInAuthRun } from '../linkedin-auth-types.ts';
export const fixtureRun = (runId = 'fake-run'): LinkedInAuthRun => ({ runId, platformAccountId: 21,
  clientName: 'SQL fixture', action: 'check', status: 'running', stage: 'queued', stageStatus: 'started',
  startedAt: '2026-09-01 00:00:00.000Z', updatedAt: '2026-09-01 00:00:00.000Z' });
test('history start/finish, ordering and restart match old storage without resuming running tasks', async () => {
  const f = linkedInFixture(), g = linkedInFixture(), sql = createSqlLinkedInStorage(f.db, f.grant).history;
  for (const history of [sql, g.legacy.history]) {
    await history.start(fixtureRun());
    await history.start({ ...fixtureRun('newer'), startedAt: '2026-09-02 00:00:00.000Z' });
  }
  assert.deepEqual(await sql.list(), await g.legacy.history.list());
  assert.deepEqual((await sql.list()).map(r => r.status), ['interrupted', 'interrupted']);
  const resumed = createSqlLinkedInStorage(f.db, f.grant).history;
  const completed = { ...fixtureRun(), status: 'succeeded' as const, stage: 'completed', finishedAt: '2026-09-03 00:00:00.000Z' };
  await resumed.finish(completed); await g.legacy.history.finish(completed);
  assert.deepEqual(await resumed.list(), await g.legacy.history.list());
  assert.equal(f.rows.get(authHistoryId)!.size, 2);
  const count = f.count(); await resumed.finish(fixtureRun('missing')); assert.equal(f.count(), count);
});
test('SQL write grants restrict accounts, columns and history; empty grant never writes', async () => {
  const f = linkedInFixture(), sql = createSqlLinkedInStorage(f.db, f.grant);
  f.set(t.accounts, 99, { clients_id: 8, platforms_id: 16 });
  for (const id of [20, 99, 999]) await assert.rejects(sql.repository.recordFailure(id, { errorCode: 'test' }));
  await assert.rejects(createSqlLinkedInStorage(f.db).history.start(fixtureRun()));
  await assert.rejects(sql.history.start({ ...fixtureRun(), platformAccountId: 99 }));
  const writes = linkedInWrites(f.db, authHistoryId, f.grant);
  await assert.rejects(writes.patchRecord(t.accounts, 21, { clients_id: 8 }));
  await assert.rejects(writes.patchRecord(t.clients, 7, { client_name: 'changed' }));
  assert.equal(f.count(), 0);
});
test('failed and uncertain writes do not retry; rollback and later readback remain available', async () => {
  const f = linkedInFixture(), storage = createSqlLinkedInStorage(f.db, f.grant);
  f.failWrite(); await assert.rejects(storage.history.start(fixtureRun())); assert.equal(f.count(), 1);
  assert.equal(f.rows.get(authHistoryId)?.size ?? 0, 0); f.failWrite(false);
  f.failAfterWrite(); const before = structuredClone(f.rows.get(t.accounts)!.get('21'));
  await assert.rejects(storage.repository.recordFailure(21, { errorCode: 'test' }));
  assert.deepEqual(f.rows.get(t.accounts)!.get('21'), before); f.failAfterWrite(false);
  const attempts = f.count(); f.uncertain();
  await assert.rejects(storage.history.start(fixtureRun()), { code: 'write_outcome_unknown' });
  assert.equal(f.count(), attempts + 1); f.uncertain(false);
  const restored = createSqlLinkedInStorage(f.db, f.grant);
  assert.equal((await restored.history.list()).length, 1);
  await restored.history.finish({ ...fixtureRun(), status: 'failed', finishedAt: '2026-09-04 00:00:00.000Z' });
  assert.equal((await restored.history.list())[0].status, 'failed');
  assert.equal(f.rows.get(authHistoryId)!.size, 1);
});
