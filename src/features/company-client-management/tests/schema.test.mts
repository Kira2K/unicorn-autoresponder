import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { planSchema, applySchema } from '../schema.mts';

test('plan is read-only, quotes mapped student keys, and apply is transactional and repeatable', async () => {
  const f = await fixture();
  try {
    const plan = await planSchema(f.pool, f.database);
    assert.equal(plan.status, 'pending');
    assert.match(plan.sql, /REFERENCES noco\."Student Records"\("Record Id"\)/);
    assert.equal((await f.db.query("SELECT to_regnamespace('company_management') AS schema")).rows[0].schema, null);
    await assert.rejects(applySchema(f.pool, f.database, 'wrong'), /migration_plan_changed/);
    assert.equal((await applySchema(f.pool, f.database, plan.checksum)).status, 'applied');
    assert.equal((await applySchema(f.pool, f.database, plan.checksum)).status, 'already_applied');
    assert.equal((await planSchema(f.pool, f.database)).status, 'applied');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco."Student Records"')).rows[0].n, 2);
    assert.ok(f.calls.some(s => s.includes('pg_advisory_xact_lock')));
  } finally { await f.db.close(); }
});

test('wrong database marker and incompatible student key block all DDL', async () => {
  const f = await fixture();
  try {
    f.identity.marker = 'wrong';
    await assert.rejects(planSchema(f.pool, f.database), /database_not_allowed/);
    assert.ok(!f.calls.some(s => s.startsWith('CREATE SCHEMA company_management')));
    f.identity.marker = f.marker;
    await f.db.exec(`UPDATE copy_meta.inventory SET definition=jsonb_set(definition,'{mapping,0,sqlType}','"text"')`);
    await assert.rejects(planSchema(f.pool, f.database), /unsupported_client_key/);
  } finally { await f.db.close(); }
});

test('schema collision is not adopted; a failed migration rolls all new tables back', async () => {
  const f = await fixture();
  try {
    const p = await planSchema(f.pool, f.database);
    f.failOn = 'CREATE TABLE company_management.company_restrictions';
    await assert.rejects(applySchema(f.pool, f.database, p.checksum), /postgres_write_failed/);
    assert.equal((await f.db.query("SELECT to_regnamespace('company_management') AS schema")).rows[0].schema, null);
    f.failOn = '';
    await f.db.exec('CREATE SCHEMA company_management');
    await assert.rejects(planSchema(f.pool, f.database), /unmanaged_company_schema/);
  } finally { await f.db.close(); }
});

test('restriction review never disables an active block; global scope must be explicit', async () => {
  const f = await fixture(true);
  try {
    await f.db.exec(`INSERT INTO company_management.companies(name) VALUES ('Same name'),('Same name');
      INSERT INTO company_management.company_restrictions(client_id,company_id,reason,review_status,review_due_at)
      VALUES (1,1,'company_listed_in_cv','needs_review','2000-01-01');`);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.active_restrictions')).rows[0].n, 1);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.company_restrictions(company_id,reason) VALUES(1,'missing_client')`), {code:'23514'});
    await f.db.exec(`INSERT INTO company_management.company_restrictions(company_id,reason,is_global) VALUES(1,'global_block',true)`);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.company_restrictions(client_id,company_id,reason,is_global) VALUES(1,1,'bad_global',true)`), {code:'23514'});
    await assert.rejects(f.db.exec(`INSERT INTO company_management.company_restrictions(client_id,company_id,reason,channels) VALUES(1,1,'bad_scope','{}')`), {code:'23514'});
    await f.db.exec(`UPDATE company_management.company_restrictions SET revoked_at=now(), revoked_by='operator', revocation_reason='resolved' WHERE client_id=1`);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.active_restrictions')).rows[0].n, 1);
  } finally { await f.db.close(); }
});

test('application identity is unique across channels even for unknown outcomes; employer and student links agree', async () => {
  const f = await fixture(true);
  try {
    await f.db.exec(`INSERT INTO company_management.companies(name) VALUES('A'),('B');
      INSERT INTO company_management.vacancies(company_id,title,canonical_url) VALUES(1,'Engineer','https://example.test/jobs/1');
      INSERT INTO company_management.applications(client_id,company_id,vacancy_id,channel,submission_status) VALUES(1,1,1,'external','unknown');`);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.applications(client_id,company_id,vacancy_id,channel) VALUES(1,1,1,'hh')`), {code:'23505'});
    await assert.rejects(f.db.exec(`INSERT INTO company_management.applications(client_id,company_id,vacancy_id,channel) VALUES(2,2,1,'external')`), {code:'23503'});
    await f.db.exec(`INSERT INTO company_management.applications(client_id,company_id,vacancy_id,channel) VALUES(2,1,1,'external');
      INSERT INTO company_management.client_company_events(client_id,company_id,application_id,event_type,source) VALUES(1,1,1,'interview_started','{}');`);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.client_company_events(client_id,company_id,application_id,event_type,source) VALUES(2,1,1,'offer_received','{}')`), {code:'23503'});
    await assert.rejects(f.db.exec(`DELETE FROM noco."Student Records" WHERE "Record Id"=1`), (e:any)=>['23503','23001'].includes(e.code));
  } finally { await f.db.close(); }
});

test('submission evidence is separate from recruitment stage and events are append-only', async () => {
  const f = await fixture(true);
  try {
    await f.db.exec(`INSERT INTO company_management.companies(name) VALUES('A');
      INSERT INTO company_management.applications(client_id,company_id,channel,submission_status,recruitment_stage)
      VALUES(1,1,'legacy','unknown','interviewing');`);
    await assert.rejects(f.db.exec(`UPDATE company_management.applications SET submission_status='submitted'`), {code:'23514'});
    await f.db.exec(`UPDATE company_management.applications SET submission_status='submitted',confirmation_kind='candidate_reported',confirmed_at=now(),evidence='{"note":"Candidate reported receipt"}';
      INSERT INTO company_management.client_company_events(client_id,company_id,event_type,source) VALUES(1,1,'note','{}');`);
    await assert.rejects(f.db.exec(`UPDATE company_management.client_company_events SET event_type='offer_received'`), {code:'23514'});
    await assert.rejects(f.db.exec('DELETE FROM company_management.client_company_events'), {code:'23514'});
    assert.equal((await f.db.query('SELECT occurred_at FROM company_management.client_company_events')).rows[0].occurred_at, null);
  } finally { await f.db.close(); }
});

test('identifier storage permits ambiguous names but conflicting verified platform IDs are rejected', async () => {
  const f = await fixture(true);
  try {
    await f.db.exec(`INSERT INTO company_management.companies(name) VALUES('A'),('A');
      INSERT INTO company_management.company_identifiers(company_id,type,namespace,value,verification_status)
      VALUES(1,'alias','name','A','verified'),(2,'alias','name','A','verified'),(1,'external_id','hh','42','verified');`);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.company_identifiers(company_id,type,namespace,value,verification_status) VALUES(2,'external_id','hh','42','verified')`), {code:'23505'});
  } finally { await f.db.close(); }
});
