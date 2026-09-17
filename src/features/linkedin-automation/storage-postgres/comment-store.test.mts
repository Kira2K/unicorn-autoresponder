import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { featureFixture } from './fixture.mts';
import { createSqlCommentStore } from './comment-store.mts';
import type { MonitorJob } from '../comment-monitor/types.ts';
const { emptyState } = createRequire(import.meta.url)('../comment-monitor/job-row.ts') as typeof import('../comment-monitor/job-row.ts');
test('comment SQL checkpoints, author context, restart, failure and scoped purge', async () => {
  const f = featureFixture(), store = createSqlCommentStore(f.db, f.grant);
  const job: MonitorJob = { jobId: 'monitor-1', platformAccountId: 21, accountId: 'fake', clientName: 'Test',
    status: 'waiting', stage: 'waiting', state: emptyState(), createdAt: '2026-09-01 00:00:00Z',
    updatedAt: '2026-09-01 00:00:00Z', expiresAt: '2026-09-14 00:00:00Z', authorHeadline: 'Go engineer' };
  await store.create(job); assert.equal((await store.get(job.jobId))?.authorHeadline, job.authorHeadline);
  job.status = 'paused'; job.state.checks = 3; job.nextCheckAt = '2026-09-13 15:00:00Z';
  await store.update(job);
  assert.equal((await createSqlCommentStore(f.db, f.grant).get(job.jobId))?.state.checks, 3);
  f.fail('patch'); job.status = 'completed'; await assert.rejects(store.update(job)); f.fail('');
  assert.equal((await store.get(job.jobId))?.status, 'paused');
  f.seed('linkedin_comment_monitor_jobs', 9, { platform_account_id: 22, job_id: 'production', created_at: '2000-01-01' });
  await store.purge('2026-09-02'); assert.deepEqual(await store.list(), []);
  assert.equal(f.rows.get('linkedin_comment_monitor_jobs')?.has(9), true);
});
