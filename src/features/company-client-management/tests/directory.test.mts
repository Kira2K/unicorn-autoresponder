import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { inspectDirectorySnapshot } from '../directory/snapshot.mts';
import { planDirectory,applyDirectory } from '../directory/import.mts';
import { planSchema } from '../schema.mts';
import type { DirectorySnapshot } from '../directory/types.mts';

function input():DirectorySnapshot {
  return {version:1,source:{fileId:'reviewed-file',capturedAt:'2026-09-26T00:00:00Z',workbookSha256:'a'.repeat(64)},companies:[
    {key:'first',name:'Current name',existingId:'1',expectedExistingName:'Old name',comment:'Source comment',markets:['Global'],tags:['Product'],languages:['En'],aliases:['Current name'],contacts:[{type:'email',value:'jobs@example.test'}],applicationRoute:'notify_only',provenance:{rows:[3]}},
    {key:'second',name:'New company',comment:'',markets:['Кипр'],tags:[],languages:[],aliases:['New company'],contacts:[],applicationRoute:'standard_workflow',provenance:{rows:[4]}}
  ],sources:[
    {key:'site',companyKey:'first',name:'Current name',type:'website',url:'https://example.test/careers',disposition:'enabled',comment:'',provenance:{cell:'C3'}},
    {key:'li',companyKey:'first',name:'Current name',type:'linkedin',url:'https://uk.linkedin.com/company/example/',disposition:'blocked_linkedin',comment:'',provenance:{}},
    {key:'agg',companyKey:null,name:'Job board',type:'aggregator',url:'https://jobs.example.test/',disposition:'enabled',comment:'Board',provenance:{cell:'C2'}}
  ]};
}
async function setup(){
  const f=await fixture(true);
  await f.db.exec(`INSERT INTO company_management.companies(name) VALUES('Old name'),('Historical only');
    INSERT INTO company_management.company_restrictions(client_id,company_id,reason) VALUES(1,1,'existing rule'),(2,2,'retain this rule');
    INSERT INTO company_management.applications(client_id,company_id,channel) VALUES(1,1,'legacy'),(2,2,'legacy');
    INSERT INTO company_management.client_company_events(client_id,company_id,application_id,event_type,source) VALUES(1,1,1,'legacy_status','{}'),(2,2,2,'legacy_status','{}');`);
  return f;
}
test('directory contract rejects missing links, duplicate mappings and enabled LinkedIn; notification-only needs no assignee',()=>{
  const s=input();assert.equal(inspectDirectorySnapshot(s).companies,2);
  s.sources[1].disposition='enabled';assert.throws(()=>inspectDirectorySnapshot(s),/linkedin_source_must_be_blocked/);
  s.sources[1].disposition='blocked_linkedin';s.sources[0].companyKey='absent';assert.throws(()=>inspectDirectorySnapshot(s),/source_company_missing/);
  s.sources[0].companyKey='first';s.companies[1].existingId='1';s.companies[1].expectedExistingName='Old name';assert.throws(()=>inspectDirectorySnapshot(s),/duplicate_existing_company_mapping/);
});
test('consolidation imports source data, preserves every history row, excludes legacy references from directory, and reconciles retries',async()=>{
  const f=await setup();try{
    const before=(await f.db.query('SELECT * FROM company_management.company_restrictions ORDER BY id')).rows;
    const events=(await f.db.query('SELECT * FROM company_management.client_company_events ORDER BY id')).rows;
    const s=input(),p=await planDirectory(f.pool,f.database,s);
    assert.equal(p.deployment.allowed,true);assert.equal(p.counts.existingCompanies,2);
    assert.equal((await f.db.query("SELECT to_regclass('company_management.sources') AS t")).rows[0].t,null);
    const result=await applyDirectory(f.pool,f.database,s,p.checksum);
    assert.equal(result.status,'applied');assert.equal(result.summary.activeCompanies,2);assert.equal(result.summary.legacyReferences,1);
    assert.deepEqual((await f.db.query('SELECT * FROM company_management.company_restrictions ORDER BY id')).rows,before);
    assert.deepEqual((await f.db.query('SELECT * FROM company_management.client_company_events ORDER BY id')).rows,events);
    const c=(await f.db.query("SELECT id,name,application_route,contact_types,source_types FROM company_management.company_directory WHERE import_key='reviewed-file:first'")).rows[0];
    assert.deepEqual(c,{id:1,name:'Current name',application_route:'notify_only',contact_types:['email'],source_types:['linkedin','website']});
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.sources WHERE company_id IS NULL')).rows[0].n,1);
    assert.equal((await planSchema(f.pool,f.database)).status,'applied');
    assert.equal((await applyDirectory(f.pool,f.database,s,p.checksum)).status,'already_applied');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM company_management.directory_imports')).rows[0].n,1);
    assert.ok(!f.calls.some(q=>/^\s*(?:DELETE FROM|TRUNCATE\s|ALTER TABLE[^;]*DISABLE TRIGGER)/im.test(q)));
  }finally{await f.db.close();}
});
test('stale data or explicit mapping conflicts stop before modifying the directory',async()=>{
  const f=await setup();try{
    const s=input(),p=await planDirectory(f.pool,f.database,s);
    await f.db.exec("UPDATE company_management.companies SET name='Edited meanwhile' WHERE id=1");
    await assert.rejects(applyDirectory(f.pool,f.database,s,p.checksum),/directory_mapping_changed|directory_plan_changed/);
    assert.equal((await f.db.query("SELECT to_regclass('company_management.sources') AS t")).rows[0].t,null);
  }finally{await f.db.close();}
});
test('partial source import failure rolls back DDL, data and receipt',async()=>{
  const f=await setup();try{
    const s=input(),p=await planDirectory(f.pool,f.database,s);f.failOn='INSERT INTO company_management.sources';
    await assert.rejects(applyDirectory(f.pool,f.database,s,p.checksum),/postgres_write_failed/);
    assert.equal((await f.db.query("SELECT name FROM company_management.companies WHERE id=1")).rows[0].name,'Old name');
    assert.equal((await f.db.query("SELECT to_regclass('company_management.directory_imports') AS t")).rows[0].t,null);
  }finally{await f.db.close();}
});
test('lost COMMIT acknowledgment is reconciled using durable receipt without importing twice',async()=>{
  const f=await setup();try{
    const s=input(),p=await planDirectory(f.pool,f.database,s);f.failCommit=true;
    await assert.rejects(applyDirectory(f.pool,f.database,s,p.checksum),/commit_uncertain/);
    f.failCommit=false;
    assert.equal((await planDirectory(f.pool,f.database,s)).status,'already_applied');
    assert.equal((await applyDirectory(f.pool,f.database,s,p.checksum)).status,'already_applied');
  }finally{await f.db.close();}
});
