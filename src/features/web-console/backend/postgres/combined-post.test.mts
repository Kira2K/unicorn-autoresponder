import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { combinedFixture } from './combined-fixture.mts';
import { featureTestProviders } from './feature-test-providers.mts';
import { createSqlFeatureServices } from './feature-services.mts';
import { defaults } from '../../../linkedin-automation/post-writer/types.ts';
for (const mode of ['approval_required', 'automatic', 'scheduled'] as const) {
  test(`actual SQL Writer: ${mode}, meme, restart and no repeated publication`, async () => {
    const f = combinedFixture(), p = featureTestProviders();
    let services = await createSqlFeatureServices(f.db, f.grant, p.providers);
    const step = async (ms = 0) => { p.advance(ms); await services.postWriter.tick();
      for (let i=0; i<30; i++) await setImmediate(); };
    const run = async () => (await services.postWriter.get(21)).runs[0];
    try {
      await services.postWriter.update(21, { ...defaults(21), memes: true,
        ...(mode === 'scheduled' ? { scheduled: true, days: [7] } : {}) });
      if (mode !== 'scheduled') {
        const a = await services.postWriter.start(21, mode, 'sql-test-first');
        assert.equal((await services.postWriter.start(21, mode, 'sql-test-second')).id, a.id);
      }
      await step();
      if (mode === 'approval_required') {
        const waiting = await run(); assert.equal(waiting.status, 'awaiting_approval'); assert(waiting.meme);
        assert.equal(p.metrics.publishes, 0);
        await services.close(); services = await createSqlFeatureServices(f.db, f.grant, p.providers);
        await assert.rejects(services.postWriter.action(waiting.id, 'approve', waiting.hash), /meme_review_required/);
        await services.postWriter.action(waiting.id, 'approve', waiting.hash, waiting.hash);
      }
      for (let i=0; i<5; i++) await step(6000);
      assert.equal((await run())?.status, 'published', JSON.stringify(await run()));
      assert.equal(p.metrics.publishes, 1); assert.equal(p.metrics.extracts, 1);
      await services.close(); services = await createSqlFeatureServices(f.db, f.grant, p.providers);
      await step(6000); assert.equal(p.metrics.publishes, 1); assert.equal(p.metrics.likes, 0);
    } finally { await services.close(); }
  });
}
