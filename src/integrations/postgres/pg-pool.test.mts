import test from 'node:test'; import assert from 'node:assert/strict';
import { createPostgresPool } from './pg-pool.mts';
import type { ConnectionOptions } from './contracts.mts';
const config: ConnectionOptions = { host: '127.0.0.1', port: 1234, database: 'unicorn_noco_copy', user: 'test', password: 'fake' };
test('pool is separate, bounded, read-only, explicit and closes without leaking provider errors', async () => {
  let captured: Record<string, unknown> = {}, handler = () => {}, ended = false;
  class Pool {
    constructor(options: Record<string, unknown>) { captured = options; }
    async connect(): Promise<never> { throw new Error('not used'); }
    async end() { ended = true; }
    on(_event: 'error', listener: () => void) { handler = listener; }
  }
  const errors: string[] = []; const pool = createPostgresPool(config, e => errors.push(e.code), Pool);
  assert.equal(captured.database, 'unicorn_noco_copy'); assert.equal(captured.max, 2);
  assert.match(String(captured.options), /default_transaction_read_only=on/);
  assert.equal(captured.statement_timeout, 10000); assert.equal(captured.connectionTimeoutMillis, 5000);
  handler(); assert.deepEqual(errors, ['postgres_connection_failed']);
  await pool.end(); assert.ok(ended);
});
test('missing configuration, CRM connection and insecure remote connection fail before creating a driver', () => {
  for (const change of [{ password: '' }, { database: 'linkedin_manager' }, { host: 'remote.example' },
    { port: 0 }, { port: 65536 }, { ssl: { ca: 'x', rejectUnauthorized: false } }]) {
    assert.throws(() => createPostgresPool({ ...config, ...change } as ConnectionOptions));
  }
});
