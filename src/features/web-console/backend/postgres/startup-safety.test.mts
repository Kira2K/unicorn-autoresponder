import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createWebConsoleApp } = require('../app.ts');
const { main } = require('../../../linkedin-automation/account-connection/cli.ts');
test('explicit SQL console cannot silently construct default Noco stores', () => {
  const previous = process.env.APP_DB; process.env.APP_DB = 'postgres';
  try {
    assert.throws(() => createWebConsoleApp({ useMockData: false }), { code: 'sql_console_dependencies_required' });
    assert.throws(() => createWebConsoleApp({ useMockData: false, repository: {} }), { code: 'sql_console_dependencies_required' });
    assert.doesNotThrow(() => createWebConsoleApp({ useMockData: false, repository: {}, linkedinAuthRuns: {},
      profileFiller: {}, commentMonitor: {}, connectionInviter: {}, postWriter: {} }));
    assert.doesNotThrow(() => createWebConsoleApp({ useMockData: true }));
  } finally { if (previous === undefined) delete process.env.APP_DB; else process.env.APP_DB = previous; }
});
test('explicit SQL auth CLI fails on missing SQL configuration, without a Noco fallback', async () => {
  const previous = process.env.APP_DB; process.env.APP_DB = 'postgres';
  try {
    await assert.rejects(main(['--client', 'Artificial', '--apply'], undefined, () => {}), { code: 'invalid_appdb_postgres_config' });
    await main(['--help'], undefined, () => {});
  } finally { if (previous === undefined) delete process.env.APP_DB; else process.env.APP_DB = previous; }
});
