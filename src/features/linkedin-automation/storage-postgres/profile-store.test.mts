import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { featureFixture } from './fixture.mts';
import { createSqlProfileStore } from './profile-store.mts';
import type { ProfileJob } from '../profile-filler/job-types.ts';
const require = createRequire(import.meta.url);
const { profileJobRow } = require('../profile-filler/job-row.ts') as typeof import('../profile-filler/job-row.ts');
const job = (): ProfileJob => ({ jobId: 'profile-test', platformAccountId: 21, clientName: 'Тест',
  status: 'preview_ready', phase: 'ready', createdAt: '2026-09-13 10:00:00.000Z', updatedAt: '2026-09-13 10:00:00.000Z' });
test('profile persistence keeps partial patches, checkpoint JSON and restart; copied jobs stay outside scope', async () => {
  const f = featureFixture(), store = createSqlProfileStore(f.db, f.grant), input = job();
  f.seed('linkedin_profile_jobs', 3, { ...profileJobRow({ ...job(), jobId: 'live', platformAccountId: 22, status: 'verifying' }) });
  await store.create(input);
  assert.equal(input.recordId, undefined);
  assert.deepEqual(await store.get(input.jobId), { ...input, recordId: 101, accountId: undefined, plan: undefined,
    planHash: undefined, result: undefined, checkpoint: undefined, errorCode: undefined, finishedAt: undefined });
  await store.update(input.jobId, { status: 'verifying', phase: 'check', planHash: 'hash', errorCode: '' });
  const restarted = createSqlProfileStore(f.db, f.grant);
  assert.equal((await restarted.get(input.jobId))?.planHash, 'hash');
  assert.deepEqual((await restarted.listPendingVerification()).map(v => v.jobId), [input.jobId]);
  assert.equal(await restarted.get('live'), undefined);
  f.fail('patch'); await assert.rejects(restarted.update(input.jobId, { status: 'succeeded' }), /patch failed/);
  assert.equal((await restarted.get(input.jobId))?.status, 'verifying');
  await assert.rejects(store.create({ ...input, platformAccountId: 22 }), /sql_test_write_forbidden/);
});
test('profile writes reject a missing table and retain an unknown commit without repeating create', async () => {
  const f = featureFixture(); f.db.listTables().shift();
  assert.throws(() => createSqlProfileStore(f.db, f.grant), /table_required/);
  const g = featureFixture(), store = createSqlProfileStore(g.db, g.grant); g.fail('commit');
  await assert.rejects(store.create(job()), /commit uncertain/);
  assert.equal(g.calls.filter(v => v === 'create').length, 1);
  assert.equal((await createSqlProfileStore(g.db, g.grant).list()).length, 1);
});
