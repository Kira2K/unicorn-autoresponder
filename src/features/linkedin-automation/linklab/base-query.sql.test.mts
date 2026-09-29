import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'dotenv';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { linkLabBaseQuery, linkLabColumns } from './base-query.mts';
import { createLinkLabFixture } from './base-fixture.mts';

test('projection excludes credentials and archived JSON', () => {
  assert.deepEqual(linkLabColumns, ['client_id', 'client_name', 'stack_id', 'stack',
    'platform_account_id', 'linkedin_url', 'data_issue']);
  assert.doesNotMatch(linkLabBaseQuery, /_copy_source|v_cimcia|SELECT\s+\*/i);
});

const envPath = process.env.LINKLAB_SQL_TEST_ENV;
test('LinkLab on PostgreSQL: isolated temporary tables', { skip: !envPath }, async t => {
  const config = readPostgresAppDbConfig(parse(readFileSync(envPath!, 'utf8')));
  assert.equal(config.database, 'unicorn_noco_copy_restore', 'Refusing a non-development database');
  const pool = createPostgresPool(config);
  const session = await pool.connect().catch(async error => { await pool.end(); throw error; });
  try {
    assert.equal((await session.query('SELECT current_database() AS db')).rows[0]?.db, config.database);
    await session.query('BEGIN READ WRITE');
    await createLinkLabFixture(session);
    const query = linkLabBaseQuery.replaceAll('noco.', 'pg_temp.') + ' ORDER BY c.id';
    const read = async () => (await session.query(query)).rows;
    const rows = await read();
    const row = (id: number | string) => rows.find(r => r.client_id === String(id))!;
    await t.test('exact membership, no duplicate students or orphan owners', () => {
      assert.deepEqual(rows.map(r => r.client_id), ['1', '2', '6', '7', '8', '9', '14', '15', '17', '18', '20', '9007199254740993']);
    });
    await t.test('same names retain their own account and stack', () => {
      assert.equal(row(1).client_name, row(2).client_name);
      assert.deepEqual([row(1).platform_account_id, row(1).stack], ['10', 'Python / Юникод']);
      assert.deepEqual([row(2).platform_account_id, row(2).stack], ['20', 'GO']);
    });
    await t.test('missing and whitespace-only credentials exclude the account', () => {
      for (const id of [3, 4, 5, 10, 19]) assert.equal(row(id), undefined);
    });
    await t.test('NULL and empty URL remain distinct', () => {
      assert.equal(row(6).linkedin_url, null); assert.equal(row(7).linkedin_url, '');
    });
    await t.test('one genuine link wins, without changing the stored URL', () => {
      assert.deepEqual([row(8).platform_account_id, row(8).linkedin_url], ['81', ' linkedin.com/in/eight/ ']);
      assert.equal(row(18).platform_account_id, '181');
    });
    await t.test('multiple links or placeholders stay ambiguous, not first-row wins', () => {
      for (const id of [9, 17]) {
        assert.equal(row(id).platform_account_id, null); assert.equal(row(id).linkedin_url, null);
        assert.equal(row(id).data_issue, 'linkedin_account_ambiguous');
      }
    });
    await t.test('deleted entities, another platform and missing stack', () => {
      for (const id of [11, 12, 13, 16]) assert.equal(row(id), undefined);
      for (const id of [6, 14, 15]) assert.deepEqual([row(id).stack_id, row(id).stack], [null, null]);
    });
    await t.test('IDs above JS safe integer keep precision', () => {
      assert.equal(row('9007199254740993').platform_account_id, '9007199254740993');
    });
    await t.test('no credentials or archive returned', () => {
      for (const value of rows) assert.deepEqual(Object.keys(value), [...linkLabColumns]);
      assert.doesNotMatch(JSON.stringify(rows), /fixture-user|fixture-password/);
    });
    await t.test('next read sees source edits; rollback restores the fixture', async () => {
      await session.query('SAVEPOINT source_change');
      await session.query(`UPDATE pg_temp.clients SET client_name = 'Updated', "01_stacks_id" = 2 WHERE id = 1;
        UPDATE pg_temp.stacks SET name = 'Updated GO' WHERE id = 2;
        UPDATE pg_temp.platform_accounts SET url = 'linkedin.com/in/updated' WHERE id = 10;`);
      const changed = (await read()).find(r => r.client_id === '1')!;
      assert.deepEqual([changed.client_name, changed.stack, changed.linkedin_url], ['Updated', 'Updated GO', 'linkedin.com/in/updated']);
      await session.query('ROLLBACK TO SAVEPOINT source_change');
      assert.deepEqual(await read(), rows);
    });
    await t.test('platform mismatch and deletion do not produce false LinkedIn rows', async () => {
      await session.query('SAVEPOINT platform_change');
      await session.query(`UPDATE pg_temp.platforms SET name = 'not-linkedin' WHERE id = 16`);
      assert.deepEqual(await read(), []);
      await session.query(`UPDATE pg_temp.platforms SET name = 'linkedin', __nc_deleted = true WHERE id = 16`);
      assert.deepEqual(await read(), []);
      await session.query('ROLLBACK TO SAVEPOINT platform_change');
    });
    await session.query('ROLLBACK');
    assert.equal((await session.query(`SELECT to_regclass('pg_temp.clients') AS fixture`)).rows[0]?.fixture, null);
  } finally {
    await session.query('ROLLBACK').catch(() => {});
    session.release(true);
    await pool.end();
  }
});
