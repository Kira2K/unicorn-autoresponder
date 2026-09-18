import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinedFixture } from './combined-fixture.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlFeatureServices } from './feature-services.mts';
async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean) {
  for (let i=0; i<150; i++) { const result = await read(); if (ready(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('SQL test service did not reach expected state');
}
test('actual services use SQL stores: preview, monitor, inviter and writer; no copied jobs resume', async () => {
  const f = combinedFixture(), p = featureTestProviders();
  f.set('linkedin_profile_jobs', 900, { job_id: 'copied', platform_account_id: 999, status: 'verifying' });
  const services = await createSqlFeatureServices(f.db, f.grant, p.providers);
  try {
    assert.deepEqual(await services.profileFiller.list(), []);
    const started = await services.profileFiller.startGeneration(21);
    const preview = await until(() => services.profileFiller.get(String(started.jobId)), job => job?.status === 'preview_ready' || job?.status === 'failed');
    assert.equal(preview?.status, 'preview_ready', JSON.stringify(preview));
    assert.equal(p.metrics.patches, 0);
    assert.equal(f.rows.get('linkedin_profile_jobs')!.size, 2);
    const monitored = await services.commentMonitor.enable(21);
    assert(monitored.jobId); await services.commentMonitor.disable(21);
    assert.equal((await services.commentMonitor.get(String(monitored.jobId)))?.status, 'disabled');
    const state = await services.postWriter.get(21);
    assert(state); assert.deepEqual(await services.connectionInviter.list(), []);
    assert((await services.connectionInviter.readiness(21)).ready);
    assert.equal((await services.profileFiller.list()).length, 1);
  } finally { await services.close(); }
  const reopened = await createSqlFeatureServices(f.db, f.grant, p.providers);
  try { assert.equal((await reopened.profileFiller.list()).length, 1);
    assert.equal((await reopened.commentMonitor.list()).length, 1); assert.equal(p.metrics.patches, 0);
  } finally { await reopened.close(); }
});
