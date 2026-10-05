import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const { Client } = createRequire(import.meta.url)('pg');
const configPath = process.env.LINKLAB_ISOLATED_PG_CONFIG;
const up = () => readFileSync(new URL('./sql/001-status.up.sql', import.meta.url), 'utf8');
const down = () => readFileSync(new URL('./sql/001-status.down.sql', import.meta.url), 'utf8');

test('LinkLab status storage on disposable local PostgreSQL', { skip: !configPath }, async t => {
  const cfg = JSON.parse(readFileSync(configPath!, 'utf8'));
  assert.equal(cfg.local_proof, true);
  assert.equal(cfg.host, '127.0.0.1');
  assert.match(cfg.target_database, /^linklab_unicorn_test_[a-f0-9]{12}$/);
  assert.match(cfg.database, /^linklab_crm_test_[a-f0-9]{12}$/);
  const connect = async () => {
    const c = new Client({ ...cfg, database: cfg.target_database, connectionTimeoutMillis: 5000,
      application_name: 'linklab-status-test' });
    await c.connect();
    assert.equal((await c.query('SELECT current_database() AS db')).rows[0].db, cfg.target_database);
    return c;
  };
  const db = await connect();
  let ownSchema = false;
  const run = (sql: string, values: unknown[] = []) => db.query(sql, values);
  const row = async (id = 1) => (await run('SELECT * FROM noco.linklab WHERE client_id=$1', [id])).rows[0];
  const changes = async (id = 1) => (await run('SELECT * FROM noco.linklab_changes WHERE client_id=$1 ORDER BY version', [id])).rows;
  const edit = (status: string, id = 1) => run('UPDATE noco.linklab SET status=$1 WHERE client_id=$2', [status, id]);
  const ack = (event: any, student = '10000000-0000-4000-8000-000000000001', receipt = randomUUID()) =>
    run('SELECT noco.linklab_acknowledge($1,$2,$3)', [event.id, student, receipt]);
  const expectError = async (action: () => Promise<unknown>, pattern: RegExp) => {
    await assert.rejects(action(), (e: any) => pattern.test(e.message));
    await run('ROLLBACK');
  };
  try {
    assert.equal((await run("SELECT to_regnamespace('noco') AS ns")).rows[0].ns, null,
      'Tests require a fresh empty database; existing schema is never reused or cleared');
    await run(`CREATE SCHEMA noco;
      CREATE TABLE noco.clients (id bigint PRIMARY KEY, client_name text, __nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platforms (id bigint PRIMARY KEY, name text, __nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platform_accounts (id bigint PRIMARY KEY, clients_id bigint, platforms_id bigint,
        url text, login text, password text, __nc_deleted boolean DEFAULT false);
      INSERT INTO noco.clients(id,client_name) VALUES (1,'Одинаковое имя'), (2,'Одинаковое имя'), (3,'Без аккаунта');
      INSERT INTO noco.platforms(id,name) VALUES (16,'LinkedIn'),(17,'hh');
      INSERT INTO noco.platform_accounts(id,clients_id,platforms_id) VALUES (11,1,16),(22,2,16),(33,1,17);`);
    ownSchema = true;
    const before = (await run('SELECT * FROM noco.clients ORDER BY id')).rows;

    await t.test('migration can be rolled back before data and reapplied', async () => {
      await run(up());
      assert.deepEqual((await run('SELECT client_role FROM noco.clients')).rows.map((r: any) => r.client_role), [null,null,null]);
      await run(down());
      assert.equal((await run("SELECT to_regclass('noco.linklab') AS t")).rows[0].t, null);
      assert.deepEqual((await run('SELECT * FROM noco.clients ORDER BY id')).rows, before);
      await run(up());
    });
    await t.test('four optional roles do not change status or create work', async () => {
      for (const value of ['клиент','ученик','реферал','фейк',null]) {
        await run('UPDATE noco.clients SET client_role=$1 WHERE id=1', [value]);
      }
      await expectError(() => run("UPDATE noco.clients SET client_role='admin' WHERE id=1"), /client_role/);
      await expectError(() => run("UPDATE noco.clients SET client_role='' WHERE id=1"), /client_role/);
      await run("UPDATE noco.clients SET client_role='ученик' WHERE id=1");
      await expectError(() => run(down()), /linklab_data_exists/);
      await run('UPDATE noco.clients SET client_role=NULL WHERE id=1');
      assert.equal((await run('SELECT count(*) FROM noco.linklab_changes')).rows[0].count, '0');
    });
    await t.test('one student, one binding, one initial event without copied credentials', async () => {
      await run(`INSERT INTO noco.linklab(client_id,platform_account_id,status) VALUES(1,11,'Новый'),(2,22,'Прогрев')`);
      assert.equal((await row()).version, '1');
      assert.equal((await row()).sync_state, 'Ожидание');
      assert.equal((await changes()).length, 1);
      await expectError(() => run(`INSERT INTO noco.linklab(client_id,platform_account_id) VALUES(1,11)`), /unique/);
      await expectError(() => run(`INSERT INTO noco.linklab(client_id,platform_account_id) VALUES(3,11)`), /account_owner/);
      await expectError(() => run(`INSERT INTO noco.linklab(client_id,platform_account_id) VALUES(3,33)`), /account_owner|linkedin_account/);
      assert.doesNotMatch(JSON.stringify(await changes()), /password|login|Одинаковое/);
      await expectError(() => run('UPDATE noco.linklab SET platform_account_id=22 WHERE client_id=1'), /binding_immutable/);
    });
    await t.test('historic Block keeps an unknown date empty; known timestamps use Moscow calendar dates', async () => {
      await run(`INSERT INTO noco.platform_accounts(id,clients_id,platforms_id) VALUES(44,3,16);
        INSERT INTO noco.linklab(client_id,platform_account_id,status) VALUES(3,44,'Блок');`);
      assert.equal((await row(3)).blocked_at, null);
      assert.equal((await row(3)).new_account_due_date, null);
      await run(`INSERT INTO noco.clients(id,client_name) VALUES(4,'Дата из достоверной истории');
        INSERT INTO noco.platform_accounts(id,clients_id,platforms_id) VALUES(55,4,16);
        INSERT INTO noco.linklab(client_id,platform_account_id,status,blocked_at)
          VALUES(4,55,'Блок','2026-08-31T21:15:00Z');`);
      assert.equal((await run('SELECT new_account_due_date::text AS d FROM noco.linklab WHERE client_id=4')).rows[0].d, '2026-10-01');
    });
    await t.test('same status is a no-op; only an actual block stamps its date', async () => {
      await edit('Новый');
      assert.equal((await changes()).length, 1);
      await edit('Блок');
      const blocked = await row();
      assert.ok(blocked.blocked_at);
      await edit('Блок');
      assert.deepEqual((await row()).blocked_at, blocked.blocked_at);
      await edit('Пауза');
      assert.deepEqual((await row()).blocked_at, blocked.blocked_at);
      await edit('Блок');
      assert.ok((await row()).blocked_at > blocked.blocked_at);
      const expected = (await run("SELECT ((blocked_at AT TIME ZONE 'Europe/Moscow')::date+30)::text AS d FROM noco.linklab WHERE client_id=1")).rows[0].d;
      assert.equal((await run('SELECT new_account_due_date::text AS d FROM noco.linklab WHERE client_id=1')).rows[0].d, expected);
    });
    await t.test('unknown status and lost transaction do not leave partial data or history', async () => {
      const previous = await row(), history = await changes();
      await expectError(() => edit('Реферальный аккаунт'), /status/);
      await run('BEGIN');
      await edit('Раскачка');
      await run('ROLLBACK');
      assert.deepEqual(await row(), previous);
      assert.deepEqual(await changes(), history);
    });
    await t.test('journal insertion failure rolls back the visible status and its version', async () => {
      const previous = await row(), history = await changes();
      await run("ALTER TABLE noco.linklab_changes ADD CONSTRAINT artificial_failure CHECK(status <> 'Раскачка') NOT VALID");
      try {
        await expectError(() => edit('Раскачка'), /artificial_failure/);
        assert.deepEqual(await row(), previous);
        assert.deepEqual(await changes(), history);
      } finally { await run('ALTER TABLE noco.linklab_changes DROP CONSTRAINT artificial_failure'); }
    });
    await t.test('new URL preserves NULL/empty/Unicode and never rebinds the account', async () => {
      for (const value of [null, '', 'https://www.linkedin.com/in/тест/?x=1']) {
        await run('UPDATE noco.linklab SET new_account_url=$1 WHERE client_id=1', [value]);
        assert.equal((await row()).new_account_url, value);
        assert.equal((await row()).platform_account_id, '11');
      }
    });
    await t.test('pending changes return only each student’s next event, not global-ID cursor', async () => {
      const pending = (await run('SELECT * FROM noco.linklab_pending_changes')).rows;
      assert.deepEqual(pending.map((r: any) => [r.client_id,r.version]).sort(), [['1','1'],['2','1'],['3','1'],['4','1']]);
    });
    await t.test('ack is ordered, idempotent, binds the right CRM student and does not erase newer edits', async () => {
      const history = await changes();
      await expectError(() => ack(history[1]), /out_of_order/);
      const receipt = randomUUID();
      await ack(history[0], undefined, receipt);
      await ack(history[0], undefined, receipt);
      assert.equal((await row()).confirmed_version, '1');
      assert.equal((await row()).sync_state, 'Ожидание');
      await expectError(() => ack(history[0]), /receipt_conflict/);
      await expectError(() => ack(history[1], '20000000-0000-4000-8000-000000000002'), /binding_conflict/);
      for (const e of history.slice(1)) await ack(e);
      assert.equal((await row()).sync_state, 'Готово');
      assert.equal((await changes()).length, history.length);
      assert.equal((await row(2)).confirmed_version, '0');
    });
    await t.test('visible failure remains until the same event is acknowledged', async () => {
      await edit('Раскачка');
      const event = (await changes()).at(-1)!;
      await run('SELECT noco.linklab_record_failure($1,$2)', [event.id,'crm_unavailable']);
      assert.equal((await row()).sync_state, 'Ошибка');
      await edit('Завершен');
      assert.equal((await row()).sync_error, 'crm_unavailable');
      await expectError(() => run('SELECT noco.linklab_record_failure($1,$2)', [event.id,'password=secret']), /error_code/);
      await ack(event);
      assert.equal((await row()).sync_state, 'Ожидание');
      assert.equal((await row()).sync_error, null);
      await ack((await changes()).at(-1)!);
      assert.equal((await row()).sync_state, 'Готово');
    });
    await t.test('old delayed failure cannot turn a confirmed event back into an error', async () => {
      const event = (await changes())[0], previous = await row();
      assert.equal((await run('SELECT noco.linklab_record_failure($1,$2) AS saved', [event.id,'crm_unavailable'])).rows[0].saved, false);
      assert.deepEqual(await row(), previous);
    });
    await t.test('two Unicorn students cannot be confirmed as the same CRM student', async () => {
      const original = await row(3), event = (await changes(3))[0];
      await expectError(() => ack(event), /linklab_crm_student_unique/);
      assert.deepEqual(await row(3), original);
      assert.equal((await changes(3))[0].crm_receipt_id, null);
    });
    await t.test('CRM command retries reuse the event; stale version and UUID misuse are rejected', async () => {
      const version = (await row()).version, op = randomUUID();
      const send = (status = 'Прогрев', expected = version) => run(
        'SELECT noco.linklab_request_status($1,$2,$3,$4) AS id', [1,expected,op,status]);
      const first = (await send()).rows[0].id;
      assert.equal((await send()).rows[0].id, first);
      assert.equal((await changes()).at(-1).source, 'crm');
      await expectError(() => send('Блок'), /operation_conflict/);
      await expectError(() => run('SELECT noco.linklab_request_status($1,$2,$3,$4)', [1,version,randomUUID(),'Пауза']), /version_conflict/);
      assert.equal((await row()).status, 'Прогрев');
    });
    await t.test('no-op CRM command remains a no-op even when retried after a later edit', async () => {
      const current = await row(), op = randomUUID(), size = (await changes()).length;
      const send = () => run('SELECT noco.linklab_request_status($1,$2,$3,$4) AS id', [1,current.version,op,current.status]);
      assert.equal((await send()).rows[0].id, null);
      assert.equal((await changes()).length, size);
      await edit('Завершен');
      assert.equal((await send()).rows[0].id, null);
      assert.equal((await row()).status, 'Завершен');
      assert.equal((await changes()).length, size + 1);
    });
    await t.test('lost commit reply can be recovered by the same CRM command', async () => {
      const connection = await connect(), op = randomUUID(), version = (await row()).version;
      let id;
      try {
        await connection.query('BEGIN');
        id = (await connection.query('SELECT noco.linklab_request_status($1,$2,$3,$4) AS id', [1,version,op,'Блок'])).rows[0].id;
        await connection.query('COMMIT'); // Ignore the reply; retry only with the same operation ID.
      } finally { await connection.end(); }
      const retried = await run('SELECT noco.linklab_request_status($1,$2,$3,$4) AS id', [1,version,op,'Блок']);
      assert.equal(retried.rows[0].id, id);
      assert.equal((await run('SELECT count(*) FROM noco.linklab_changes WHERE source_operation_id=$1', [op])).rows[0].count, '1');
    });
    await t.test('concurrent Noco saves serialize, preserve both events, and do not affect another student', async () => {
      const connection = await connect(), control = await row(2), oldVersion = BigInt((await row()).version);
      try {
        await run('BEGIN');
        await edit('Новый');
        const second = connection.query("UPDATE noco.linklab SET status='Пауза' WHERE client_id=1");
        await run('COMMIT');
        await second;
      } finally { await connection.end(); }
      assert.equal((await row()).version, String(oldVersion + 2n));
      assert.equal((await row()).status, 'Пауза');
      assert.deepEqual((await changes()).slice(-2).map((e: any) => e.status), ['Новый','Пауза']);
      assert.deepEqual(await row(2), control);
    });
    await t.test('two workers confirming the same event advance only once', async () => {
      const event = (await changes(2))[0], receipt = randomUUID();
      const connection = await connect();
      try {
        const values = [event.id, '20000000-0000-4000-8000-000000000002', receipt];
        const results = await Promise.all([
          run('SELECT noco.linklab_acknowledge($1,$2,$3) AS applied', values),
          connection.query('SELECT noco.linklab_acknowledge($1,$2,$3) AS applied', values),
        ]);
        assert.deepEqual(results.map(r => r.rows[0].applied).sort(), [false,true]);
        assert.equal((await row(2)).confirmed_version, '1');
        assert.equal((await changes(2)).length, 1);
      } finally { await connection.end(); }
    });
    await t.test('restricted Noco role edits fields but cannot confirm, forge versions or change schema', async () => {
      await run(`CREATE ROLE linklab_status_noco;
        GRANT USAGE ON SCHEMA noco TO linklab_status_noco;
        GRANT SELECT ON noco.linklab TO linklab_status_noco;
        GRANT UPDATE(status,new_account_url) ON noco.linklab TO linklab_status_noco;
        SET ROLE linklab_status_noco;`);
      try {
        await edit('Прогрев');
        await expectError(() => run('UPDATE noco.linklab SET confirmed_version=version WHERE client_id=1'), /permission denied/);
        await expectError(() => run('UPDATE noco.linklab SET version=100 WHERE client_id=1'), /permission denied/);
        await expectError(() => run('SELECT noco.linklab_acknowledge(1,$1,$2)', [randomUUID(),randomUUID()]), /permission denied/);
        await expectError(() => run('SELECT noco.linklab_request_status(1,1,$1,$2)', [randomUUID(),'Блок']), /permission denied/);
        await expectError(() => run("SELECT noco.linklab_record_failure(1,'crm_unavailable')"), /permission denied/);
        await expectError(() => run('ALTER TABLE noco.linklab ADD COLUMN must_not_exist text'), /owner/);
        await expectError(() => run('DELETE FROM noco.linklab WHERE client_id=1'), /permission denied/);
        await expectError(() => run("INSERT INTO noco.linklab(client_id,platform_account_id) VALUES(3,33)"), /permission denied/);
      } finally { await run('RESET ROLE'); }
    });
    await t.test('migration does not rerun or roll back over saved data', async () => {
      const previous = await row(), history = await changes();
      await expectError(() => run(up()), /already exists/);
      await expectError(() => run(down()), /linklab_data_exists/);
      assert.deepEqual(await row(), previous);
      assert.deepEqual(await changes(), history);
      assert.deepEqual((await run('SELECT id,client_name,__nc_deleted FROM noco.clients WHERE id<=3 ORDER BY id')).rows, before);
    });
    await t.test('normal account deletion keeps history and exposes the missing binding', async () => {
      const original = await row(3), control = await row(2), history = await changes(3);
      await expectError(() => run('UPDATE noco.linklab SET platform_account_id=NULL WHERE client_id=3'), /binding_immutable/);
      await run('DELETE FROM noco.platform_accounts WHERE id=44');
      const current = await row(3), events = await changes(3);
      assert.equal(current.platform_account_id, null);
      assert.equal(current.account_issue, 'linkedin_account_missing');
      assert.equal(current.status, original.status);
      assert.deepEqual(events.slice(0,-1), history);
      assert.deepEqual(events.at(-1).changed_fields, ['platform_account_id']);
      assert.equal(events.at(-1).platform_account_id, null);
      assert.deepEqual(await row(2), control);
    });
  } finally {
    await run('ROLLBACK');
    if (ownSchema) {
      // Only this suite created the initially absent schema in a verified disposable database.
      await run('DROP SCHEMA noco CASCADE');
      await run('DROP ROLE IF EXISTS linklab_status_noco');
    }
    await db.end();
  }
});
