import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeReader, createRuntimePostgresDb } from './runtime.mts';
import { readPostgresAppDbConfig } from './config.mts';
import { workingFake } from '../../../integrations/postgres/working-fixture.mts';
import { unusedSheets } from './test-fixture.mts';
const env = { APP_DB_POSTGRES_HOST: '127.0.0.1', APP_DB_POSTGRES_PORT: '5432',
  APP_DB_POSTGRES_DATABASE: 'unicorn_noco_copy_restore', APP_DB_POSTGRES_USER: 'fake', APP_DB_POSTGRES_PASSWORD: ' fake ' };
test('explicit SQL config rejects CRM, missing and unsafe values, without ambient PG fallback', () => {
  const config = readPostgresAppDbConfig(env);
  assert.equal(config.password, ' fake ');
  for (const change of [{ APP_DB_POSTGRES_DATABASE: 'linkedin_manager' }, { APP_DB_POSTGRES_PASSWORD: '' },
    { APP_DB_POSTGRES_PORT: 'invalid' }, { APP_DB_POSTGRES_PORT: '65536' }, { APP_DB_POSTGRES_HOST: 'remote.invalid' }])
    assert.throws(() => readPostgresAppDbConfig({ ...env, ...change }));
  assert.throws(() => readPostgresAppDbConfig({ PGHOST: '127.0.0.1', PGPASSWORD: 'fake', PGDATABASE: 'unicorn_noco_copy' }));
  assert.equal(readPostgresAppDbConfig({ ...env, APP_DB_POSTGRES_HOST: 'remote.invalid', APP_DB_POSTGRES_SSL_CA: 'ca' }).ssl?.rejectUnauthorized, true);
});
test('runtime is lazy, shares metadata initialization, uses read-only and closes once', async () => {
  const f = workingFake(); let opens = 0, closes = 0;
  const runtime = createRuntimeReader(readPostgresAppDbConfig(env), () => {
    opens++; return { ...f.pool, async end() { closes++; } };
  });
  assert.equal(opens, 0);
  const [a, b] = await Promise.all([runtime.read(), runtime.read()]);
  assert.equal(a, b); assert.equal(opens, 1);
  assert.equal(f.state.calls.filter(c => c.text.includes('copy_meta.inventory')).length, 1);
  assert.equal(f.state.calls[0].text, 'BEGIN READ ONLY');
  await Promise.all([runtime.close(), runtime.close()]); assert.equal(closes, 1);
  await assert.rejects(runtime.read(), /appdb_postgres_closed/);
});
test('failed initialization is not retried automatically; a new read may recover', async () => {
  const f = workingFake(); f.state.fail = 'copy_meta.inventory';
  const runtime = createRuntimeReader(readPostgresAppDbConfig(env), () => f.pool);
  await assert.rejects(runtime.read(), /postgres_read_failed/);
  assert.equal(f.state.calls.filter(c => c.text.includes('copy_meta.inventory')).length, 1);
  f.state.fail = ''; await runtime.read(); await runtime.close();
  assert.equal(f.state.calls.filter(c => c.text.includes('copy_meta.inventory')).length, 2);
});
test('missing SQL settings fail SQL methods rather than silently selecting Sheets', async () => {
  const saved = process.env.APP_DB_POSTGRES_DATABASE;
  delete process.env.APP_DB_POSTGRES_DATABASE;
  try { await assert.rejects(createRuntimePostgresDb(unusedSheets).getAutomationTargets(), /invalid_appdb_postgres_config/); }
  finally { if (saved !== undefined) process.env.APP_DB_POSTGRES_DATABASE = saved; }
});
