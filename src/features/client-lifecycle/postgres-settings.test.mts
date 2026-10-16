import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { COPY_MARKER, type SqlPool } from '../../integrations/postgres/contracts.mts';
import { loadClientNotificationSettings } from './postgres-settings.mts';
import { testMessageConfig } from './message-config.test-helper.mts';

const row = {
  instructions_url: testMessageConfig.instructionsUrl,
  hh_instructions_url: testMessageConfig.hhInstructionsUrl,
  cabinet_url: testMessageConfig.cabinetUrl,
  cabinet_password: testMessageConfig.cabinetPassword,
  support_tag: testMessageConfig.supportTag,
  support_chat_id: '-9005',
};
function fixture(rows: Record<string, unknown>[] = [row], failure?: Error) {
  const calls: string[] = [];
  let releases = 0;
  const pool: SqlPool = { async end() {}, async connect() {
    return { release() { releases++; }, async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database: 'unicorn_noco_copy_restore', marker: COPY_MARKER }] };
      if (sql.includes('client_notification_settings')) {
        if (failure) throw failure;
        return { rows };
      }
      return { rows: [] };
    } };
  } };
  return { pool, calls, releases: () => releases };
}

test('SQL settings preserve the message contract and perform read-only queries only', async () => {
  const f = fixture();
  assert.deepEqual(await loadClientNotificationSettings(f.pool, 'unicorn_noco_copy_restore'),
    { messageConfig: testMessageConfig, supportChatId: '-9005' });
  assert.equal(f.releases(), 1);
  assert.ok(f.calls.includes('BEGIN READ ONLY'));
  assert.ok(!f.calls.some(sql => /INSERT|UPDATE|DELETE|CREATE|ALTER/.test(sql)));
});
test('missing SQL settings fail closed, without falling back to ENV or defaults', async () => {
  const f = fixture([]);
  await assert.rejects(loadClientNotificationSettings(f.pool, 'unicorn_noco_copy_restore'), /client_notification_settings_required/);
  assert.equal(f.releases(), 1);
});
test('SQL settings reject an invalid report recipient and never echo stored values', async () => {
  for (const value of ['', '0', '@synthetic_test_support', '-12 extra']) {
    const f = fixture([{ ...row, support_chat_id: value }]);
    await assert.rejects(loadClientNotificationSettings(f.pool, 'unicorn_noco_copy_restore'),
      { message: 'client_notification_settings_invalid:support_chat_id' });
  }
  const f = fixture([{ ...row, cabinet_url: 'https://user:synthetic-secret@example.invalid' }]);
  await assert.rejects(loadClientNotificationSettings(f.pool, 'unicorn_noco_copy_restore'), error => {
    assert.equal((error as Error).message, 'client_message_configuration_invalid:cabinetUrl');
    assert.doesNotMatch((error as Error).message, /synthetic-secret|synthetic-cabinet-password/);
    return true;
  });
});
test('database errors are sanitized and the connection is released', async () => {
  const f = fixture([], Error('provider error contains synthetic-secret'));
  await assert.rejects(loadClientNotificationSettings(f.pool, 'unicorn_noco_copy_restore'),
    { message: 'postgres_read_failed' });
  assert.equal(f.releases(), 1);
});

const port = Number(process.env.CLIENTS_LOCAL_TEST_PORT);
test('local SQL settings: repeatable empty migration, app reads only, reload and unchanged business data', { skip: !port }, async () => {
  assert.equal(process.env.CLIENTS_LOCAL_TEST_HOST, '127.0.0.1');
  assert(port >= 1024 && port <= 65535);
  const { Pool } = createRequire(import.meta.url)('pg');
  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'unicorn_noco_copy_restore', max: 1 });
  let inserted = false, readerCreated = false, grantedUsage = false;
  const reader = 'clients_settings_reader_' + process.pid;
  try {
    const before = (await pool.query('SELECT id,client_name,client_status FROM noco.clients ORDER BY id')).rows;
    // The artificial schema fixture omits the application's existing production USAGE.
    if (!(await pool.query("SELECT has_schema_privilege('unicorn_sql_app','noco','USAGE') AS allowed")).rows[0].allowed) {
      await pool.query('GRANT USAGE ON SCHEMA noco TO unicorn_sql_app');
      grantedUsage = true;
    }
    const migration = readFileSync(new URL('../../integrations/postgres/clients-dashboard/004-notification-settings.up.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    await pool.query(migration);
    assert.equal((await pool.query('SELECT count(*) FROM noco.client_notification_settings')).rows[0].count, '0');
    await assert.rejects(loadClientNotificationSettings(pool, 'unicorn_noco_copy_restore'), /client_notification_settings_required/);
    await pool.query(`INSERT INTO noco.client_notification_settings
      (singleton,instructions_url,hh_instructions_url,cabinet_url,cabinet_password,support_tag,support_chat_id)
      VALUES(true,$1,$2,$3,$4,$5,$6)`, Object.values(row));
    inserted = true;
    await pool.query(`CREATE ROLE ${reader} NOLOGIN`);
    readerCreated = true;
    await pool.query(`GRANT SELECT ON noco.client_notification_settings TO ${reader}`);
    await pool.query(migration);
    assert.equal((await pool.query("SELECT has_table_privilege($1,'noco.client_notification_settings','SELECT') AS allowed", [reader])).rows[0].allowed, false);
    await pool.query('SET ROLE unicorn_sql_app');
    assert.deepEqual(await loadClientNotificationSettings(pool, 'unicorn_noco_copy_restore'),
      { messageConfig: testMessageConfig, supportChatId: '-9005' });
    const rights = (await pool.query(`SELECT
      has_table_privilege(current_user,'noco.client_notification_settings','INSERT') AS can_insert,
      has_table_privilege(current_user,'noco.client_notification_settings','UPDATE') AS can_update,
      has_table_privilege(current_user,'noco.client_notification_settings','DELETE') AS can_delete`)).rows[0];
    assert.deepEqual(rights, { can_insert: false, can_update: false, can_delete: false });
    await assert.rejects(pool.query('UPDATE noco.client_notification_settings SET support_chat_id=\'1\''), { code: '42501' });
    await pool.query('RESET ROLE');
    await pool.query('UPDATE noco.client_notification_settings SET support_chat_id=$1', ['-9006']);
    assert.equal((await loadClientNotificationSettings(pool, 'unicorn_noco_copy_restore')).supportChatId, '-9006');
    const after = (await pool.query('SELECT id,client_name,client_status FROM noco.clients ORDER BY id')).rows;
    assert.deepEqual(after, before);
  } finally {
    await pool.query('RESET ROLE');
    if (inserted) await pool.query('DELETE FROM noco.client_notification_settings WHERE support_tag=$1 AND cabinet_password=$2',
      [row.support_tag, row.cabinet_password]);
    if (readerCreated) await pool.query(`DROP ROLE ${reader}`);
    if (grantedUsage) await pool.query('REVOKE USAGE ON SCHEMA noco FROM unicorn_sql_app');
    await pool.end();
  }
});
