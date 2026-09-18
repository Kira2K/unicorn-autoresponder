import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlConsole } from './runtime.mts';
import { sqlAppOptions } from './app-options.mts';
import { runtimeFixture } from './runtime-fixture.mts';
import { openSqlAuth } from '../../../linkedin-automation/account-connection/postgres-runtime.mts';
import { createLivePostWriter } from '../../../linkedin-automation/post-writer/runtime.ts';
import { createConfiguredApp } from '../configured-app.mts';

test('SQL startup resolves every store before services; allocator failure closes pool and never migrates', async () => {
  const f = runtimeFixture();
  const runtime = await openSqlConsole(f.env, () => f.pool);
  assert.equal(typeof runtime.options.repository.getClientById, 'function');
  assert.equal(typeof runtime.options.linkedinStorage.profile.list, 'function');
  assert.equal(typeof runtime.options.linkedinStorage.posts.cvRows, 'function');
  assert.equal(f.calls.filter(c => c.includes('has_sequence_privilege')).length, 11);
  assert.ok(!f.calls.some(c => /nextval|ALTER|INSERT|UPDATE/.test(c)));
  await runtime.close(); await runtime.close(); assert.equal(f.state.ends, 1);
  const g = runtimeFixture(); g.state.ready = false;
  await assert.rejects(openSqlConsole(g.env, () => g.pool), /postgres_id_allocator_required/);
  assert.equal(g.state.ends, 1);
});
test('normal configured entrypoint fails closed on SQL errors; mock never opens SQL', async () => {
  let calls = 0;
  const open = async () => { calls++; throw Object.assign(Error('offline'), { code: 'postgres_read_unavailable' }); };
  await assert.rejects(createConfiguredApp({ APP_DB: 'postgres' }, open), { code: 'postgres_read_unavailable' });
  const mock = await createConfiguredApp({ APP_DB: 'postgres', WEB_CONSOLE_USE_MOCK_DATA: 'true' }, open);
  await mock.closeStorage(); assert.equal(calls, 1);
});
test('SQL CLI uses the SQL account repository and closes it; no ID or external provider in check setup', async () => {
  const f = runtimeFixture(), runtime = await openSqlAuth({ apply: false }, f.env, () => f.pool);
  assert.equal(runtime.dependencies.adapter, undefined);
  assert.deepEqual(await runtime.dependencies.repository.listAccounts(), []);
  assert.ok(!f.calls.some(c => /nextval|INSERT|ALTER/.test(c)));
  await runtime.close(); assert.equal(f.state.ends, 1);
});
test('Writer reads its injected SQL storage without Noco or model credentials', async () => {
  const { f } = runtimeFixture();
  const options = sqlAppOptions(f.db, f.grant, { accountIds: new Set([21]), create: f.grant.create });
  assert.equal((await options.linkedinStorage.generation.getGenerationContext(21)).cvUrl, 'https://example.invalid/cv.pdf');
  const writer = createLivePostWriter(options.linkedinStorage.repository, { acquire: () => () => {} },
    { env: { LINKEDIN_POST_WRITER_ENABLED: 'false' }, storage: options.linkedinStorage.posts });
  try {
    const result = await writer.get(21);
    assert.equal(result.writable, false); assert.equal(f.count(), 0);
  } finally { await writer.close(); }
});
