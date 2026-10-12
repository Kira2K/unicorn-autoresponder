import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { importLegacySnapshot } from '../legacy-import.mts';
import { inspectSnapshot,sourceTables } from '../legacy-snapshot.mts';
import type { LegacySnapshot,LegacyRecord,LegacyKind } from '../legacy-snapshot.mts';
const row=(kind:LegacyKind,key:string,values:Record<string,unknown>,clientKeys:string[]=[],companyKeys:string[]=[]):LegacyRecord=>({kind,tableId:sourceTables[kind],key,values,clientKeys,companyKeys,issues:[]});
const snapshot=():LegacySnapshot=>({version:1,capturedAt:'2026-09-25T00:00:00Z',records:[
  row('company','10',{company_name:'Same company'}),row('company','11',{company_name:'Same company'}),
  row('restriction','20',{market:'both',from_legend_resume_companies:'Same company',currently_interviewing_companies:'Other spelling'},['1'],['10','11']),
  row('restriction','21',{market:'en',offer_companies:'Someone'},[],['10']),
  row('application','30',{status_raw:'Success / interview / ???',company_name:'Same company'},['1'],['10']),
  row('application','31',{status_raw:'offer'},['2'],[]),
  row('student_stop_list','1',{stop_list_company:'Unknown employer'},['1'])
]});

test('legacy import preserves evidence, blocks native-linked companies and never guesses names, clients or confirmations',async()=>{
  const f=await fixture(true);
  try{
    const s=snapshot(),result=await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal(result.importedSources,7);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.companies')).rows[0].n,2);
    const rules=(await f.db.query('SELECT client_id,is_global,market,review_status FROM company_management.active_restrictions')).rows;
    assert.equal(rules.length,2);assert.ok(rules.every(r=>r.client_id===1 && r.is_global===false && r.market==='all' && r.review_status==='needs_review'));
    const app=(await f.db.query('SELECT submission_status,confirmation_kind,vacancy_id FROM company_management.applications')).rows;
    assert.deepEqual(app,[{submission_status:'unknown',confirmation_kind:'none',vacancy_id:null}]);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.legacy_records')).rows[0].n,7);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.vacancies')).rows[0].n,0);
    assert.ok(result.needsReview>=4);
    assert.equal((await f.db.query('SELECT occurred_at,assertion_status FROM company_management.client_company_events')).rows[0].occurred_at,null);
    assert.ok(!f.calls.some(sql=>/^\s*(INSERT INTO|UPDATE|DELETE FROM) noco\./i.test(sql)));
  }finally{await f.db.close();}
});

test('repeat import is idempotent, preserves revocations, and changed source evidence requires reconciliation',async()=>{
  const f=await fixture(true);
  try{
    const s=snapshot();await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    await f.db.exec(`UPDATE company_management.company_restrictions SET revoked_at=now(),revoked_by='operator',revocation_reason='reviewed' WHERE id=1`);
    const again=await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal(again.importedSources,0);assert.equal(again.existingSources,7);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.active_restrictions')).rows[0].n,1);
    s.records[0].values.company_name='Changed';
    await assert.rejects(importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum),/legacy_source_changed/);
    assert.equal((await f.db.query('SELECT name FROM company_management.companies WHERE id=1')).rows[0].name,'Same company');
    await assert.rejects(f.db.exec(`UPDATE company_management.legacy_records SET payload='{}'`),{code:'23514'});
  }finally{await f.db.close();}
});

test('reviewed checksum is required; invalid student links never create a global restriction',async()=>{
  const f=await fixture(true);
  try{
    const s=snapshot();
    await assert.rejects(importLegacySnapshot(f.pool,f.database,s,'wrong'),/legacy_plan_changed/);
    s.records[2].clientKeys=['999'];
    await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.company_restrictions')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.legacy_records')).rows[0].n,7);
  }finally{await f.db.close();}
});

test('commit uncertainty propagates without a blind retry; later inspection/import reconciles persisted records',async()=>{
  const f=await fixture(true);
  try{
    const s=snapshot();f.failCommit=true;
    await assert.rejects(importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum),/commit_uncertain/);
    assert.equal(f.calls.filter(q=>q==='COMMIT').length,2); // schema + one import, no retry
    f.failCommit=false;
    const result=await importLegacySnapshot(f.pool,f.database,s,inspectSnapshot(s).checksum);
    assert.equal(result.existingSources,7);assert.equal(result.importedSources,0);
  }finally{await f.db.close();}
});
