import assert from 'node:assert/strict';
import test from 'node:test';
import { readLinkLabBase } from './read-base.mts';
import { linkLabBaseQuery, linkLabColumns } from './base-query.mts';

function fixture(options: { database?: string; readonly?: string; fail?: boolean } = {}) {
  const queries: string[] = [], released: boolean[] = [];
  let attempts = 0;
  const pool = { async connect() { return {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes('current_database()')) return { rows: [{
        database: options.database ?? 'unicorn_noco_copy_restore', read_only: options.readonly ?? 'on'
      }] };
      if (sql.startsWith(linkLabBaseQuery)) {
        attempts++;
        if (options.fail && attempts === 1) throw new Error('read_failed');
        return { rows: [{ client_id: '9007199254740993', client_name: 'Test', linkedin_url: null }] };
      }
      return { rows: [] };
    }, release(destroy = false) { released.push(destroy); }
  }; }, async end() {} };
  return { pool, queries, released };
}
test('explicit readonly transaction preserves values and bigint IDs', async () => {
  const f = fixture();
  assert.deepEqual(await readLinkLabBase(f.pool, 'unicorn_noco_copy_restore'), [
    { client_id: '9007199254740993', client_name: 'Test', linkedin_url: null }
  ]);
  assert.equal(f.queries[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(f.queries.at(-1), 'ROLLBACK');
  assert.deepEqual(f.released, [false]);
});
test('wrong database or writable transaction stops before the data query', async () => {
  for (const options of [{ database: 'unicorn_noco_copy' }, { readonly: 'off' }]) {
    const f = fixture(options);
    await assert.rejects(readLinkLabBase(f.pool, 'unicorn_noco_copy_restore'), /target_mismatch/);
    assert.ok(!f.queries.some(q => q.startsWith(linkLabBaseQuery)));
    assert.deepEqual(f.released, [true]);
  }
});
test('unsupported database does not connect', async () => {
  const f = fixture();
  await assert.rejects(readLinkLabBase(f.pool, 'linkedin_manager'), /not_allowed/);
  assert.deepEqual(f.queries, []);
});
test('SQL failure propagates, releases the connection and permits a fresh read', async () => {
  const f = fixture({ fail: true });
  await assert.rejects(readLinkLabBase(f.pool, 'unicorn_noco_copy_restore'), /read_failed/);
  assert.equal((await readLinkLabBase(f.pool, 'unicorn_noco_copy_restore')).length, 1);
  assert.deepEqual(f.released, [true, false]);
});
test('projection excludes credentials and archived JSON', () => {
  assert.deepEqual(linkLabColumns, ['client_id', 'client_name', 'stack_id', 'stack',
    'platform_account_id', 'linkedin_url', 'data_issue']);
  assert.doesNotMatch(linkLabBaseQuery, /_copy_source|v_cimcia|SELECT\s+\*/i);
});
