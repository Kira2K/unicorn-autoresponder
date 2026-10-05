import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts';
import { workingCrud } from '../../../integrations/postgres/working-crud.mts';
import { workingReads } from '../../../integrations/postgres/working-reads.mts';
import type { PostgresTransaction } from '../../../integrations/postgres/working-client.mts';
import type { ResumeWorkflowRecord } from '../../web-console/backend/types.ts';
import type { ConsoleSql } from '../../web-console/backend/postgres/contracts.mts';
import { consoleWrites } from '../../web-console/backend/postgres/writes.mts';
import { tableIds } from '../../web-console/backend/postgres/tables.mts';
import { createLinkLabIntake, type IntakeTransaction } from './intake.mts';

const { Client } = createRequire(import.meta.url)('pg');
const configPath = process.env.LINKLAB_ISOLATED_PG_CONFIG;
const migration = (name: string) => readFileSync(new URL(`./sql/${name}.sql`, import.meta.url), 'utf8');

test('cabinet handoff and EN approval use actual isolated SQL transactions', { skip: !configPath }, async t => {
  const cfg = JSON.parse(readFileSync(configPath!, 'utf8'));
  assert.equal(cfg.local_proof, true); assert.equal(cfg.host, '127.0.0.1');
  assert.match(cfg.target_database, /^linklab_unicorn_test_[a-f0-9]{12}$/);
  const connect = async () => { const c = new Client({ ...cfg, database: cfg.target_database }); await c.connect(); return c; };
  const admin = await connect(), q = (sql: string, values: unknown[] = []) => admin.query(sql, values);
  let owned = false, ownedRole = false, nextId = 100, appRole = false;
  const definition = (id: string, name: string, fields: string[]) => ({ definition: {
    id, title: name, table_name: name, sqlName: name, sqlTable: `noco.${name}`,
    columns: [{ id: id + '_id', title: 'Id', pk: true }, ...fields.map(f => ({ id: id + '_' + f, title: f }))],
    mapping: [{ id: id + '_id', title: 'Id', sqlName: 'id', sqlType: 'bigint' },
      ...fields.map(f => ({ id: id + '_' + f, title: f, sqlName: f, sqlType: f.endsWith('_id') ? 'bigint' : 'text' }))]
  } });
  const catalog = createWorkingCatalog([
    definition(tableIds.accounts, 'platform_accounts', ['clients_id', 'platforms_id', 'login', 'password', 'url']),
    definition(tableIds.cv, 'cv_processing', ['clients_id', 'status', 'en_version_url', 'workflow_trace', 'last_responsible', 'last_workflow_error'])
  ]);
  const transaction: IntakeTransaction = async run => {
    const c = await connect();
    try {
      await c.query('BEGIN');
      if (appRole) await c.query('SET LOCAL ROLE linklab_intake_test');
      const result = await run(c, { ...workingReads(c, catalog), ...workingCrud(c, catalog) } as PostgresTransaction);
      await c.query('COMMIT'); return result;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
  };
  const intake = createLinkLabIntake(transaction, tableIds.cv,
    (sql, id) => sql.query('SELECT id FROM noco.cv_processing WHERE id=$1 FOR UPDATE', [id]));
  const db = { listTables: () => catalog.list().map(x => catalog.get(x.id)),
    getRecord: (table: string, key: string[]) => transaction((_s, tx) => tx.getRecord(table, key)) } as ConsoleSql;
  const port = consoleWrites(db, { clientIds: new Set([1,2,3,4,5,6,7,8]), linklab: intake,
    create: (tx, table, data) => tx.createRecord(table, { Id: ++nextId, ...data }) });
  const create = (client: number, data = {}) => port.createRecord(tableIds.accounts, { clients_id: client, platforms_id: 16, ...data });
  const edit = (id: number, data: Record<string, unknown>) => port.patchRecord(tableIds.accounts, id, data);
  const link = async (client: number) => (await q('SELECT * FROM noco.linklab WHERE client_id=$1', [client])).rows[0];
  const beforeCv = async (id: number): Promise<ResumeWorkflowRecord> => {
    const r = (await q('SELECT * FROM noco.cv_processing WHERE id=$1', [id])).rows[0];
    return { id, clientId: Number(r.clients_id), enVersionUrl: r.en_version_url,
      workflowTrace: r.workflow_trace ?? '', status: r.status } as ResumeWorkflowRecord;
  };
  const approve = (w: ResumeWorkflowRecord) => intake.englishApproval(w, {
    status: 'Russian version in process', workflow_trace: w.workflowTrace + '\napproved',
    last_responsible: 'provider', last_workflow_error: ''
  });
  try {
    assert.equal((await q("SELECT to_regnamespace('noco') AS n")).rows[0].n, null, 'never clear a pre-existing database');
    await q(`CREATE SCHEMA noco;
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,"01_stacks_id" bigint,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.stacks(id bigint PRIMARY KEY,name text,__nc_deleted boolean);
      CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),
        platforms_id bigint REFERENCES noco.platforms(id),login text,password text,url text,__nc_deleted boolean DEFAULT false,
        _copy_id text UNIQUE,_copy_source jsonb);
      CREATE TABLE noco.cv_processing(id bigint PRIMARY KEY,clients_id bigint REFERENCES noco.clients(id),status text,
        en_version_url text,workflow_trace text,last_responsible text,last_workflow_error text,_copy_id text UNIQUE,_copy_source jsonb);
      INSERT INTO noco.clients(id,client_name) SELECT n,'Искусственный ученик' FROM generate_series(1,8) n;
      INSERT INTO noco.platforms(id,name) VALUES(16,'LinkedIn'),(17,'hh');`);
    owned = true;
    await q(migration('001-status.up')); await q(migration('002-crm-results.up'));
    await t.test('003 round trip does not change source rows or existing setup', async () => {
      await q(migration('003-intake.up')); await q(migration('003-intake.down')); await q(migration('003-intake.up'));
      assert.equal((await q('SELECT count(*) FROM noco.clients')).rows[0].count, '8');
    });
    await q(migration('004-proxy-status.up'));
    await q(migration('005-credentials-refresh.up'));
    await t.test('both credential orders create one handoff only when complete', async () => {
      const a = await create(1, { login: 'fixture' });
      assert.equal(await link(1), undefined);
      await edit(a.Id, { password: 'fixture-password' });
      const first = await link(1); assert.equal(first.status, 'Новый');
      await edit(a.Id, { password: 'changed-fixture' });
      assert.deepEqual(await link(1), first);
      const b = await create(2, { password: 'fixture-password' });
      assert.equal(await link(2), undefined);
      await edit(b.Id, { login: 'fixture' }); assert.ok(await link(2));
      const events = (await q('SELECT source,handoff FROM noco.linklab_changes ORDER BY id')).rows;
      assert.deepEqual(events, [{ source: 'cabinet', handoff: true }, { source: 'cabinet', handoff: true }]);
      assert.doesNotMatch(JSON.stringify((await q('SELECT * FROM noco.linklab_changes')).rows), /fixture-password|changed-fixture/);
    });
    await t.test('existing status, incomplete credentials and another platform are preserved', async () => {
      await q("UPDATE noco.linklab SET status='Раскачка' WHERE client_id=1");
      await edit(101, { login: 'changed' }); assert.equal((await link(1)).status, 'Раскачка');
      await create(3, { platforms_id: 17, login: 'fixture', password: 'fixture' });
      assert.equal(await link(3), undefined);
      const row = await create(3, { login: 'fixture', password: ' \t\n' });
      assert.equal(await link(3), undefined);
      await edit(row.Id, { password: 'fixture' }); assert.ok(await link(3));
    });
    await t.test('later incomplete credentials retain history and expose the problem', async () => {
      const old = await link(1);
      await edit(101, { password: '' });
      assert.equal((await link(1)).credentials_issue, null, 'account save does not update LinkLab');
      assert.equal((await q('SELECT noco.linklab_refresh_credentials() AS n')).rows[0].n, '1');
      assert.equal((await link(1)).credentials_issue, 'linkedin_credentials_incomplete');
      assert.equal((await link(1)).status, old.status);
      assert.equal((await link(1)).version, old.version);
      await edit(101, { password: 'fixture' });
      await q('SELECT noco.linklab_refresh_credentials()');
      assert.equal((await link(1)).credentials_issue, null);
      assert.equal((await q('SELECT noco.linklab_refresh_credentials() AS n')).rows[0].n, '0');
    });
    await t.test('a rejected LinkLab warning cannot roll back an existing account save', async () => {
      const old = await link(1);
      await q('ALTER TABLE noco.linklab ADD CONSTRAINT fixture_warning_failure CHECK(credentials_issue IS NULL) NOT VALID');
      try {
        await edit(101, { password: '' });
        await assert.rejects(q('SELECT noco.linklab_refresh_credentials()'), /fixture_warning_failure/);
        assert.equal((await q('SELECT password FROM noco.platform_accounts WHERE id=101')).rows[0].password, '');
        assert.deepEqual(await link(1), old, 'no partial change or status reset');
      } finally { await q('ALTER TABLE noco.linklab DROP CONSTRAINT fixture_warning_failure'); }
      await q('SELECT noco.linklab_refresh_credentials()');
      assert.equal((await link(1)).credentials_issue, 'linkedin_credentials_incomplete');
      await edit(101, { password: 'fixture' });
      await q('SELECT noco.linklab_refresh_credentials()');
    });
    await t.test('refresh handles NULL, whitespace and soft deletion without changing source data', async () => {
      for (const password of [null, ' \t\n', 'fixture']) {
        await q('UPDATE noco.platform_accounts SET password=$1 WHERE id=101', [password]);
        await q('SELECT noco.linklab_refresh_credentials()');
        assert.equal((await link(1)).credentials_issue, password === 'fixture' ? null : 'linkedin_credentials_incomplete');
        assert.equal((await q('SELECT password FROM noco.platform_accounts WHERE id=101')).rows[0].password, password);
      }
      await q('UPDATE noco.platform_accounts SET __nc_deleted=true WHERE id=101');
      await q('SELECT noco.linklab_refresh_credentials()');
      assert.equal((await link(1)).credentials_issue, 'linkedin_account_missing');
      await q('UPDATE noco.platform_accounts SET __nc_deleted=false WHERE id=101');
      await q('SELECT noco.linklab_refresh_credentials()');
      assert.equal((await link(1)).credentials_issue, null);
    });
    await t.test('005 rollback and reapply preserve rows and restore only the original trigger', async () => {
      const snapshot = async () => (await q('SELECT to_jsonb(l) AS row FROM noco.linklab l ORDER BY id')).rows;
      const before = await snapshot();
      await q(migration('005-credentials-refresh.down'));
      assert.deepEqual(await snapshot(), before);
      await q('BEGIN');
      try {
        await q("UPDATE noco.platform_accounts SET password='' WHERE id=101");
        assert.equal((await link(1)).credentials_issue, 'linkedin_credentials_incomplete');
      } finally { await q('ROLLBACK'); }
      await q(migration('005-credentials-refresh.up'));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await q("SELECT count(*) FROM pg_trigger WHERE tgname='linklab_credentials_changed'")).rows[0].count, '0');
    });
    await t.test('duplicate accounts select only the unique profile URL', async () => {
      const a = await create(4, { login: 'fixture' });
      const b = await create(4, { login: 'fixture', url: 'https://linkedin.com/in/fixture' });
      await edit(a.Id, { password: 'fixture' }); assert.equal(await link(4), undefined);
      await edit(b.Id, { password: 'fixture' }); assert.equal((await link(4)).platform_account_id, String(b.Id));
      const x = await create(5, { login: 'fixture', url: 'https://linkedin.com/in/one' });
      await create(5, { login: 'fixture', url: 'https://linkedin.com/in/two' });
      await edit(x.Id, { password: 'fixture' }); assert.equal(await link(5), undefined);
    });
    await t.test('a failed journal update rolls back the account too', async () => {
      await q('ALTER TABLE noco.linklab_changes ADD CONSTRAINT fixture_failure CHECK(NOT handoff) NOT VALID');
      try { await assert.rejects(create(6, { login: 'fixture', password: 'fixture' }), /fixture_failure/); }
      finally { await q('ALTER TABLE noco.linklab_changes DROP CONSTRAINT fixture_failure'); }
      assert.equal(await link(6), undefined);
      assert.equal((await q('SELECT count(*) FROM noco.platform_accounts WHERE clients_id=6')).rows[0].count, '0');
    });
    await t.test('concurrent completion and retry produce one handoff', async () => {
      const a = await create(6, { login: 'fixture' });
      await Promise.all([edit(a.Id, { password: 'fixture' }), edit(a.Id, { password: 'fixture' })]);
      await edit(a.Id, { password: 'fixture' });
      assert.equal((await q('SELECT count(*) FROM noco.linklab_changes WHERE client_id=6')).rows[0].count, '1');
    });
    await q(`INSERT INTO noco.cv_processing(id,clients_id,status,en_version_url,workflow_trace,_copy_id)
      VALUES(701,7,'English version in approve by student','https://example.invalid/en','old','["701"]'),
      (801,8,'English version in approve by student','https://example.invalid/en2','old','["801"]');`);
    await t.test('EN approval before handoff survives, does not wait for RU, and blocks stale clicks', async () => {
      const before = await beforeCv(701);
      await approve(before);
      assert.equal((await beforeCv(701)).status, 'Russian version in process');
      await assert.rejects(approve(before), { code: 'resume_workflow_stale_status' });
      const date = (await q('SELECT approved_at FROM noco.linklab_cv_approvals WHERE client_id=7')).rows[0].approved_at;
      await create(7, { login: 'fixture', password: 'fixture' });
      assert.deepEqual((await link(7)).en_approved_at, date);
      assert.equal((await link(7)).version, '1');
      assert.equal((await link(8)), undefined);
    });
    await t.test('changed EN URL and failed date write do not save the transition', async () => {
      const before = await beforeCv(801);
      await assert.rejects(approve({ ...before, enVersionUrl: 'old-url' }), { code: 'resume_workflow_stale_status' });
      await q('ALTER TABLE noco.linklab_cv_approvals ADD CONSTRAINT fixture_failure CHECK(client_id<>8)');
      try { await assert.rejects(approve(before), /fixture_failure/); }
      finally { await q('ALTER TABLE noco.linklab_cv_approvals DROP CONSTRAINT fixture_failure'); }
      assert.deepEqual(await beforeCv(801), before);
      const results = await Promise.allSettled([approve(before), approve(before)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal((await q('SELECT count(*) FROM noco.linklab_cv_approvals WHERE client_id=8')).rows[0].count, '1');
    });
    await t.test('rollback refuses to erase handoffs and approvals', async () => {
      await assert.rejects(q(migration('003-intake.down')), /linklab_intake_data_exists/); await q('ROLLBACK');
      assert.equal((await q('SELECT count(*) FROM noco.linklab_cv_approvals')).rows[0].count, '2');
    });
    await t.test('limited application role can save intake and approval, but cannot alter schema', async () => {
      await q('CREATE ROLE linklab_intake_test'); ownedRole = true;
      await q(`GRANT USAGE ON SCHEMA noco TO linklab_intake_test;
        GRANT SELECT ON ALL TABLES IN SCHEMA noco TO linklab_intake_test;
        GRANT UPDATE(client_role) ON noco.clients TO linklab_intake_test;
        GRANT INSERT,UPDATE ON noco.platform_accounts,noco.cv_processing TO linklab_intake_test;
        GRANT INSERT(client_id,platform_account_id) ON noco.linklab TO linklab_intake_test;
        GRANT UPDATE(handoff,source) ON noco.linklab_changes TO linklab_intake_test;
        GRANT INSERT,UPDATE ON noco.linklab_cv_approvals TO linklab_intake_test;
        GRANT USAGE ON SEQUENCE noco.linklab_id_seq TO linklab_intake_test;`);
      await q("UPDATE noco.cv_processing SET status='English version in approve by student' WHERE id=801");
      appRole = true;
      await create(8, { login: 'fixture', password: 'fixture' });
      await approve(await beforeCv(801));
      await assert.rejects(transaction(sql => sql.query('ALTER TABLE noco.linklab ADD COLUMN forbidden text')), /owner/);
      await assert.rejects(transaction(sql => sql.query('SELECT noco.linklab_refresh_credentials()')), /permission denied/);
      await edit(101, { password: '' });
      assert.equal((await link(1)).credentials_issue, null);
      appRole = false;
      await q('SELECT noco.linklab_refresh_credentials()');
      assert.equal((await link(1)).credentials_issue, 'linkedin_credentials_incomplete');
      assert.ok((await link(8)).en_approved_at);
    });
  } finally {
    await q('ROLLBACK');
    if (ownedRole) { await q('DROP OWNED BY linklab_intake_test'); await q('DROP ROLE linklab_intake_test'); }
    if (owned) await q('DROP SCHEMA noco CASCADE');
    await admin.end();
  }
});
