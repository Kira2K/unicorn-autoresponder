import assert from 'node:assert/strict';
import { createSecuredGroupReader } from './secured-group.mts';
import { COPY_MARKER } from '../../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../../integrations/postgres/contracts.mts';

const calls: Array<{ sql: string; values?: unknown[] }> = [];
let rows: Record<string, unknown>[] = [], fail = false;
const pool: SqlPool = {
  async connect() { return {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy', marker: COPY_MARKER }] };
      if (sql.includes('FROM noco.clients')) { if (fail) throw Error('secret provider details'); return { rows }; }
      return { rows: [] };
    },
    release() {}
  }; },
  async end() {}
};
const find = createSecuredGroupReader(pool, 'unicorn_noco_copy');
rows = [{ client_name: 'Test', secured_general_chat_id: '-123', secured_general_chat_invitation_link: 'https://t.me/+fake_test' }];
assert.equal((await find(' @TEST_TAG ')).kind, 'found');
const select = calls.find(c => c.sql.includes('FROM noco.clients'))!;
assert.deepEqual(select.values, ['test_tag']);
assert.match(select.sql, /LIMIT 2/);
assert.equal(calls[0].sql, 'BEGIN READ ONLY');
assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
rows = [rows[0], rows[0]];
assert.equal((await find('test_tag')).kind, 'ambiguous-student');
fail = true;
await assert.rejects(find('test_tag'), error => error instanceof Error && error.message === 'postgres_read_failed');
console.log('secured group SQL tests passed');
