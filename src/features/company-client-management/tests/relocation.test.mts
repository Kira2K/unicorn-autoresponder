import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mts';
import { seedLegacy } from './legacy-fixture.mts';
import { exportLegacySnapshot } from '../legacy-export.mts';
import { importLegacySnapshot } from '../legacy-import.mts';
import { inspectSnapshot } from '../legacy-snapshot.mts';
import { planDirectory,applyDirectory } from '../directory/import.mts';
import { planSchema } from '../schema.mts';
import { planBusinessRelocation,applyBusinessRelocation } from '../relocation/index.mts';
import { parseCommand } from '../cli.mts';
import type { DirectorySnapshot } from '../directory/types.mts';

async function setup() {
  const f=await fixture(true);
  await seedLegacy(f);
  const legacy=await exportLegacySnapshot(f.pool,f.database);
  await importLegacySnapshot(f.pool,f.database,legacy,inspectSnapshot(legacy).checksum);
  const input:DirectorySnapshot={version:1,source:{fileId:'source-file',capturedAt:'2026-09-26T00:00:00Z',workbookSha256:'b'.repeat(64)},companies:[
    {key:'current',name:'Current',comment:'Verified source',markets:['Global'],tags:[],languages:[],aliases:[],contacts:[],applicationRoute:'notify_only',provenance:{row:3}}
  ],sources:[{key:'website',companyKey:'current',name:'Current',type:'website',url:'https://example.test/jobs',disposition:'enabled',comment:'',provenance:{cell:'C3'}}]};
  const directory=await planDirectory(f.pool,f.database,input);
  await applyDirectory(f.pool,f.database,input,directory.checksum);
  await f.db.exec('CREATE ROLE test_noco_reader; GRANT USAGE ON SCHEMA noco TO test_noco_reader;');
  return Object.assign(f,{legacy,input,directory});
}

test('relocation requires an explicit reviewed plan and UI role',()=>{
  assert.throws(()=>parseCommand(['relocate-apply','--noco-role','test_reader']),/reviewed_checksum_required/);
  assert.throws(()=>parseCommand(['relocate-plan']),/noco_role_required/);
  assert.equal(parseCommand(['relocate-plan','--noco-role','test_reader']).command,'relocate-plan');
});

test('moves business objects in place, preserves rows/IDs/FKs/sequences, keeps evidence private, and reconciles old import commands',async()=>{
  const f=await setup();try {
    const before=(await f.db.query('SELECT * FROM company_management.companies ORDER BY id')).rows;
    const oid=(await f.db.query("SELECT 'company_management.companies'::regclass::oid AS id")).rows[0].id;
    const p=await planBusinessRelocation(f.pool,f.database,'test_noco_reader');
    assert.equal(p.status,'pending');assert.equal(p.deployment.allowed,true);
    assert.equal((await f.db.query("SELECT to_regclass('noco.companies') AS x")).rows[0].x,null);
    const r=await applyBusinessRelocation(f.pool,f.database,'test_noco_reader',p.checksum);
    assert.equal(r.status,'applied');assert.equal(r.counts.companies,3);assert.equal(r.counts.sources,1);
    assert.deepEqual((await f.db.query('SELECT * FROM noco.companies ORDER BY id')).rows,before);
    assert.equal((await f.db.query("SELECT 'noco.companies'::regclass::oid AS id")).rows[0].id,oid);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.company_directory')).rows[0].n,1);
    assert.equal((await f.db.query("SELECT to_regclass('company_management.companies') AS x")).rows[0].x,null);
    const p2=await planBusinessRelocation(f.pool,f.database,'test_noco_reader');
    assert.equal(p2.status,'already_applied');assert.equal(p2.checksum,p.checksum);
    assert.equal((await applyBusinessRelocation(f.pool,f.database,'test_noco_reader',p.checksum)).status,'already_applied');
    assert.equal((await planSchema(f.pool,f.database)).businessSchema,'noco');
    assert.equal((await applyDirectory(f.pool,f.database,f.input,f.directory.checksum)).status,'already_applied');
    const repeat=await importLegacySnapshot(f.pool,f.database,f.legacy,inspectSnapshot(f.legacy).checksum);
    assert.equal(repeat.importedSources,0);
    await f.db.exec("INSERT INTO noco.companies(name) VALUES('Next');");
    assert.equal((await f.db.query("SELECT id FROM noco.companies WHERE name='Next'")).rows[0].id,4);
    await assert.rejects(f.db.exec("INSERT INTO noco.sources(import_key,company_id,name,type,url,disposition,provenance) VALUES('invalid',999,'Invalid','website','https://example.test','enabled','{}')"),{code:'23503'});
    await assert.rejects(f.db.exec('DELETE FROM noco.client_company_events'),{code:'23514'});
    await f.db.exec('SET ROLE test_noco_reader');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.company_directory')).rows[0].n,1);
    await assert.rejects(f.db.exec('SELECT * FROM company_management.directory_imports'),{code:'42501'});
    await assert.rejects(f.db.exec("UPDATE noco.companies SET name='Not allowed'"),{code:'42501'});
    await f.db.exec('RESET ROLE');
  }finally{await f.db.close();}
});

test('target table and index collisions block relocation before any DDL',async()=>{
  const f=await setup();try {
    await f.db.exec('CREATE TABLE noco.companies(id bigint);');
    await assert.rejects(planBusinessRelocation(f.pool,f.database,'test_noco_reader'),/company_relocation_collision/);
    await f.db.exec('DROP TABLE noco.companies; CREATE TABLE noco.companies_pkey(id bigint);');
    await assert.rejects(planBusinessRelocation(f.pool,f.database,'test_noco_reader'),/company_relocation_collision/);
    assert.ok((await f.db.query("SELECT to_regclass('company_management.companies') AS x")).rows[0].x);
  }finally{await f.db.close();}
});

test('stale plans, wrong roles and partial DDL failures preserve the original schema',async()=>{
  const f=await setup();try {
    const p=await planBusinessRelocation(f.pool,f.database,'test_noco_reader');
    await assert.rejects(applyBusinessRelocation(f.pool,f.database,'test_noco_reader','a'.repeat(64)),/company_relocation_plan_changed/);
    await assert.rejects(planBusinessRelocation(f.pool,f.database,'missing_role'),/company_relocation_role_missing/);
    // Fail after the objects moved and preservation was checked, before the receipt/commit.
    f.failOn='GRANT SELECT ON noco.';
    await assert.rejects(applyBusinessRelocation(f.pool,f.database,'test_noco_reader',p.checksum),/postgres_write_failed/);
    f.failOn='';
    assert.ok((await f.db.query("SELECT to_regclass('company_management.companies') AS x")).rows[0].x);
    assert.equal((await f.db.query("SELECT to_regclass('noco.companies') AS x")).rows[0].x,null);
    assert.equal((await planBusinessRelocation(f.pool,f.database,'test_noco_reader')).status,'pending');
  }finally{await f.db.close();}
});

test('lost commit acknowledgment is reconciled from the migration receipt without repeating moves',async()=>{
  const f=await setup();try {
    const p=await planBusinessRelocation(f.pool,f.database,'test_noco_reader');f.failCommit=true;
    await assert.rejects(applyBusinessRelocation(f.pool,f.database,'test_noco_reader',p.checksum),/commit_uncertain/);
    f.failCommit=false;
    assert.equal((await planBusinessRelocation(f.pool,f.database,'test_noco_reader')).status,'already_applied');
    assert.equal((await applyBusinessRelocation(f.pool,f.database,'test_noco_reader',p.checksum)).status,'already_applied');
  }finally{await f.db.close();}
});
