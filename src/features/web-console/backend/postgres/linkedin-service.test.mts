import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { linkedInFixture } from './linkedin-fixture.mts';
import { createSqlAuthTestService } from './linkedin-test-service.mts';
import type { LinkedInAuthRunService } from '../linkedin-auth-types.ts';
const require = createRequire(import.meta.url);
const { createLinkedInAuthRunService } = require('../linkedin-auth-runs.ts') as {
  createLinkedInAuthRunService(options: unknown): LinkedInAuthRunService };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('account gate blocks duplicate start; completed history survives service recreation', async () => {
  const f = linkedInFixture(); let sends = 0, finish!: () => void;
  const service = createSqlAuthTestService(f.db, async () => { sends++; await new Promise<void>(r => { finish = r; }); return { mode: 'fake' }; }, f.grant);
  const run = await service.start(21, 'check');
  await assert.rejects(service.start(21, 'connect'), { code: 'linkedin_auth_run_active' });
  assert.equal(sends, 1); finish();
  for (let i=0; i<20 && (await service.listHistory())[0]?.status !== 'succeeded'; i++) await tick();
  assert.equal(service.get(run.runId)!.status, 'succeeded');
  const restored = createSqlAuthTestService(f.db, async () => { sends++; return {}; }, f.grant);
  assert.equal((await restored.listHistory())[0].status, 'succeeded');
  assert.equal(sends, 1); assert.equal(restored.get(run.runId), undefined);
});
test('executor exceptions preserve failed status; out-of-scope account never reaches executor', async () => {
  const f = linkedInFixture(); let calls = 0;
  const service = createSqlAuthTestService(f.db, async () => { calls++; throw Object.assign(Error('fake'), { code: 'unipile_request_failed' }); }, f.grant);
  await assert.rejects(service.start(20, 'check')); assert.equal(calls, 0);
  const run = await service.start(21, 'check');
  for (let i=0; i<20 && (await service.listHistory())[0]?.status !== 'failed'; i++) await tick();
  assert.equal(service.get(run.runId)!.status, 'failed'); assert.equal(calls, 1);
});
test('existing history-start failure is observed equally on Noco and SQL, not silently fixed', async () => {
  for (const kind of ['noco', 'sql']) {
    const f = linkedInFixture(); let calls = 0;
    const execute = async () => { calls++; return { mode: 'fake' }; };
    const service = kind === 'sql' ? createSqlAuthTestService(f.db, execute, f.grant)
      : createLinkedInAuthRunService({ ...f.legacy, execute });
    f.failWrite(); const run = await service.start(21, 'check');
    await tick(); assert.equal(calls, 1); assert.equal(service.get(run.runId)!.status, 'succeeded');
    assert.deepEqual(await service.listHistory(), []);
  }
});
