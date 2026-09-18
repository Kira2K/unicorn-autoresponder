import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinedFixture } from './combined-fixture.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlFeatureServices } from './feature-services.mts';
import { createSqlProfileStore } from '../../../linkedin-automation/storage-postgres/profile-store.mts';
import type { ProfileJob } from '../../../linkedin-automation/profile-filler/job-types.ts';
import { fixturePlan, headlineStep } from '../../../linkedin-automation/profile-filler/tests/stability-fixtures.ts';

test('SQL checkpoint with unknown PATCH resumes only read-back, retaining next verification time', async () => {
  const f = combinedFixture(), p = featureTestProviders(); let reads = 0;
  p.providers.profile.client.getOwnProfile = async () => { reads++; return { description: 'New' }; };
  const store = createSqlProfileStore(f.db, { accountIds: new Set([21]), create: f.grant.create });
  const at = new Date(0).toISOString(), plan = fixturePlan([headlineStep]);
  plan.account.platformAccountId = 21;
  const job: ProfileJob = { jobId: 'uncertain-sql', platformAccountId: 21, clientName: 'Fixture',
    accountId: plan.account.accountId, status: 'verifying', phase: 'final_verification:1/1',
    createdAt: at, updatedAt: at, plan, result: { status: 'verifying', startedAt: at, updatedAt: at,
      verification: { attempt: 1, maxAttempts: 2, nextReadBackAt: at }, steps: [{
        stepId: 'headline', section: 'headline', status: 'verifying', message: 'Unknown PATCH',
        attempt: 1, maxAttempts: 2, nextActionAt: at, writeIntent: { step: headlineStep, savedAt: at }
      }] } };
  await store.create(job);
  assert.equal((await store.get(job.jobId))?.result?.verification?.nextReadBackAt, at);
  const services = await createSqlFeatureServices(f.db, f.grant, p.providers);
  try {
    await services.profileFiller.recoverPending?.();
    for (let i=0; i<100; i++) {
      if ((await services.profileFiller.get(job.jobId))?.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await store.get(job.jobId))?.status, 'succeeded');
    assert(reads > 0); assert.equal(p.metrics.patches, 0);
  } finally { await services.close(); }
});
