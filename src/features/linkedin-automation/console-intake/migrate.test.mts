import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateOutlookRegistration,migrateExistingConnection } from './migrate.mts';
import { COPY_MARKER } from '../../../integrations/postgres/contracts.mts';
import type { SqlPool } from '../../../integrations/postgres/contracts.mts';

function fixture(marker = COPY_MARKER, failDdl = false) {
  const calls: string[] = [];
  let released = false;
  const pool: SqlPool = { async end() {}, async connect() { return {
    release() { released = true; },
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker }] };
      if (failDdl && sql.includes('ALTER TABLE noco.platform_accounts')) throw new Error('ddl failed');
      return { rows: [] };
    }
  }; } };
  return { pool, calls, released: () => released };
}
test('migration defaults to rollback and applies only when requested', async () => {
 for(const migrate of [migrateOutlookRegistration,migrateExistingConnection]){
  for (const apply of [false, true]) {
    const f = fixture();
    const result = await migrate(f.pool, 'unicorn_noco_copy_restore', apply);
    assert.equal(result.applied, apply);
    assert.equal(f.calls.includes('COMMIT'), apply);
    assert.equal(f.calls.filter(sql => sql.includes('ALTER TABLE noco.platform_accounts')).length, 2);
    assert.equal(f.calls.at(-1), 'ROLLBACK');
    assert.equal(f.released(), true);
  }
 }
});
test('migration rejects another database marker before DDL and rolls back on failure', async () => {
  const wrong = fixture('unrelated');
  await assert.rejects(migrateOutlookRegistration(wrong.pool, 'unicorn_noco_copy_restore', true), { code: 'database_not_allowed' });
  assert.equal(wrong.calls.some(sql => sql.startsWith('ALTER TABLE')), false);
  const failed = fixture(COPY_MARKER, true);
  await assert.rejects(migrateOutlookRegistration(failed.pool, 'unicorn_noco_copy_restore', true));
  assert.equal(failed.calls.includes('COMMIT'), false);
  assert.equal(failed.calls.at(-1), 'ROLLBACK');
  assert.equal(failed.released(), true);
});
