import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { seedLegacy } from './legacy-fixture.mts';
import { exportLegacySnapshot } from '../legacy-export.mts';
import { importLegacySnapshot } from '../legacy-import.mts';
import { inspectSnapshot } from '../legacy-snapshot.mts';
import { planSchema,applySchema } from '../schema.mts';

test('current mapped SQL rows and native joins export/import end to end without changing original records',async()=>{
  const f=await fixture();
  try{
    await seedLegacy(f);
    const s=await exportLegacySnapshot(f.pool,f.database);
    assert.equal(s.records.length,5);
    assert.deepEqual(s.records.find(r=>r.kind==='restriction')?.companyKeys,['10','11']);
    const before=await f.db.query('SELECT * FROM noco.legacy_restrictions');
    assert.ok(f.calls.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
    assert.ok(!f.calls.some(q=>q.includes('_copy_source')));
    const plan=await planSchema(f.pool,f.database);await applySchema(f.pool,f.database,plan.checksum);
    const result=await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal(result.restrictions,2);assert.equal(result.applications,1);
    assert.deepEqual((await f.db.query('SELECT * FROM noco.legacy_restrictions')).rows,before.rows);
    const summary=(await f.db.query('SELECT application_count,captured_count,candidate_reported_count,active_block_count FROM company_management.client_company_summary WHERE company_id=1')).rows[0];
    assert.deepEqual(summary,{application_count:1,captured_count:0,candidate_reported_count:0,active_block_count:1});
  }finally{await f.db.close();}
});

test('partial import failure rolls back evidence and all derived records; source text is parameterized',async()=>{
  const f=await fixture(true);
  try{
    await seedLegacy(f);const s=await exportLegacySnapshot(f.pool,f.database);
    s.records[0].values.company_name="Name'); DROP TABLE noco.legacy_companies; --";
    f.failOn='INSERT INTO company_management.client_company_events';
    await assert.rejects(importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum),/postgres_write_failed/);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.legacy_records')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.company_restrictions')).rows[0].n,0);
    f.failOn='';await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal((await f.db.query('SELECT name FROM company_management.companies ORDER BY id LIMIT 1')).rows[0].name,s.records[0].values.company_name);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.legacy_companies')).rows[0].n,2);
  }finally{await f.db.close();}
});

test('physical key drift and missing reporting views stop preflight',async()=>{
  const f=await fixture();
  try{
    await f.db.exec('ALTER TABLE noco."Student Records" RENAME COLUMN "Record Id" TO renamed');
    await assert.rejects(planSchema(f.pool,f.database),/client_key_mapping_mismatch/);
    await f.db.exec('ALTER TABLE noco."Student Records" RENAME COLUMN renamed TO "Record Id"');
    const plan=await planSchema(f.pool,f.database);await applySchema(f.pool,f.database,plan.checksum);
    await f.db.exec('DROP VIEW company_management.client_company_summary');
    await assert.rejects(planSchema(f.pool,f.database),/company_schema_incomplete/);
  }finally{await f.db.close();}
});

test('expiry, independent reasons, global restrictions and correction ownership remain distinct',async()=>{
  const f=await fixture(true);
  try{
    await f.db.exec(`INSERT INTO company_management.companies(name) VALUES('A');
      INSERT INTO company_management.company_restrictions(client_id,company_id,reason) VALUES(1,1,'cv'),(1,1,'interview');
      INSERT INTO company_management.company_restrictions(client_id,company_id,reason,active_from,active_until)
        VALUES(1,1,'old_hold','2000-01-01','2001-01-01');
      INSERT INTO company_management.company_restrictions(company_id,is_global,reason) VALUES(1,true,'global');
      UPDATE company_management.company_restrictions SET revoked_at=now(),revoked_by='operator',revocation_reason='process ended' WHERE reason='interview';
      INSERT INTO company_management.client_company_events(client_id,company_id,event_type,source) VALUES(1,1,'interview_ended','{}');`);
    const rows=(await f.db.query('SELECT client_id,active_block_count FROM company_management.client_company_summary ORDER BY client_id')).rows;
    assert.deepEqual(rows,[{client_id:1,active_block_count:2},{client_id:2,active_block_count:1}]);
    await assert.rejects(f.db.exec(`INSERT INTO company_management.client_company_events(client_id,company_id,event_type,source,supersedes_event_id) VALUES(2,1,'correction','{}',1)`),{code:'23503'});
    await assert.rejects(f.db.exec(`TRUNCATE company_management.client_company_events`), (e:any)=>['23514','0A000'].includes(e.code));
  }finally{await f.db.close();}
});
