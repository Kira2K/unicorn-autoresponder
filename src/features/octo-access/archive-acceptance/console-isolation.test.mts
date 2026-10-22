import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveConsoleDriver } from '../../web-console/e2e/octo-console.e2e.mts';
const env = { OCTO_ENABLED: '1', OCTO_API_TOKEN: 'not-a-real-token', OCTO_ACCESS_SCOPE: 'allowlist',
  OCTO_ALLOWED_CLIENT_IDS: '901,902', OCTO_HOME_FOLDER_UUID: 'a'.repeat(32), OCTO_GUEST_FOLDER_UUID: 'b'.repeat(32),
  OCTO_GUEST_PASSWORD: 'test-only', APP_DB_POSTGRES_HOST: '127.0.0.1', APP_DB_POSTGRES_USER: 'test-only',
  APP_DB_POSTGRES_PASSWORD: 'test-only', APP_DB_POSTGRES_DATABASE: 'unicorn_noco_copy' };
test('full Console acceptance refuses the application database before opening a connection or worker', () => {
  assert.throws(() => createLiveConsoleDriver(env, { async verify() { assert.fail('no owner task should run'); } }),
    /isolated_restore_database_required/);
});
test('full Console acceptance refuses all-client scope even with two listed clients', () => {
  assert.throws(() => createLiveConsoleDriver({ ...env, OCTO_ACCESS_SCOPE: 'all' },
    { async verify() { assert.fail('no owner task should run'); } }), /exactly_two_allowed_clients_required/);
});
