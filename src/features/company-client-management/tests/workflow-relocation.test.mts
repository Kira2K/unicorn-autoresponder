import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeFixture } from './runtime-fixture.mts';
import { planWorkflowRelocation,applyWorkflowRelocation } from '../workflow-relocation/index.mts';
import { WORKFLOW_TABLES } from '../workflow-relocation/definition.mts';
import { planSchema } from '../schema.mts';
import { parseCommand } from '../cli.mts';
import { planRestoreRestrictions,restoreRestrictions } from '../restrictions/restore.mts';

test('workflow tables move in place into noco with their keys, JSON bytes and reader access intact',async()=>{
  const f=await runtimeFixture();try {
    await f.db.exec(`INSERT INTO company_management.collection_runs(id,collection,checksum) VALUES('run','{"b":2,"a":1}','hash');
      INSERT INTO noco.vacancies(company_id,title,canonical_url) SELECT id,'Java','https://example.test/role' FROM noco.companies LIMIT 1;
      INSERT INTO company_management.vacancy_stacks SELECT 'run',id,5,'matched','{}' FROM noco.vacancies;
      INSERT INTO company_management.application_batches(client_id,id,state) VALUES(1,'batch','{"status":"unknown"}');`);
    const oid=(await f.db.query("SELECT 'company_management.collection_runs'::regclass::oid AS oid")).rows[0].oid;
    await restoreRestrictions(f.pool,f.database,await planRestoreRestrictions(f.pool,f.database));
    const plan=await planWorkflowRelocation(f.pool,f.database);
    assert.equal(plan.backup?.collection_runs.length,1);
    assert.equal((await applyWorkflowRelocation(f.pool,f.database,plan.checksum)).status,'applied');
    assert.equal((await applyWorkflowRelocation(f.pool,f.database,plan.checksum)).status,'already_applied');
    assert.equal((await planSchema(f.pool,f.database)).status,'applied');
    assert.equal((await f.db.query("SELECT 'noco.collection_runs'::regclass::oid AS oid")).rows[0].oid,oid);
    assert.equal((await f.db.query('SELECT collection::text AS value FROM noco.collection_runs')).rows[0].value,'{"b":2,"a":1}');
    for(const name of WORKFLOW_TABLES) {
      assert.equal((await f.db.query('SELECT to_regclass($1) AS old',['company_management.'+name])).rows[0].old,null);
      assert.equal((await f.db.query('SELECT count(*)::int n FROM noco.'+name)).rows[0].n,1);
    }
    await assert.rejects(f.db.exec("INSERT INTO noco.vacancy_stacks VALUES('missing',1,5,'matched','{}')"),{code:'23503'});
    await assert.rejects(f.db.exec("DELETE FROM noco.collection_runs WHERE id='run'"),/vacancy_stacks_run_id_fkey/);
    await f.db.exec('SET ROLE test_noco_runtime');
    for(const name of WORKFLOW_TABLES)assert.equal((await f.db.query('SELECT count(*)::int n FROM noco.'+name)).rows[0].n,1);
    await f.db.exec('RESET ROLE');
  }finally{await f.db.close();}
});

test('workflow relocation refuses collisions and stale backups, and rolls back failed moves',async()=>{
  const f=await runtimeFixture();try {
    await f.db.exec('CREATE TABLE noco.vacancy_stacks_pkey(id int)');
    await assert.rejects(planWorkflowRelocation(f.pool,f.database),/workflow_relocation_collision/);
    await f.db.exec('DROP TABLE noco.vacancy_stacks_pkey');
    const plan=await planWorkflowRelocation(f.pool,f.database);
    await f.db.exec("INSERT INTO company_management.collection_runs VALUES('late','{}','hash',NULL,now())");
    await assert.rejects(applyWorkflowRelocation(f.pool,f.database,plan.checksum),/workflow_relocation_plan_changed/);
    const current=await planWorkflowRelocation(f.pool,f.database);
    f.failOn='GRANT SELECT ON noco.';
    await assert.rejects(applyWorkflowRelocation(f.pool,f.database,current.checksum));f.failOn='';
    assert.equal((await f.db.query("SELECT to_regclass('noco.collection_runs') AS name")).rows[0].name,null);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM company_management.collection_runs')).rows[0].n,1);
  }finally{await f.db.close();}
});

test('lost workflow migration commit acknowledgement is reconciled without repeating writes',async()=>{
  const f=await runtimeFixture();try {
    const plan=await planWorkflowRelocation(f.pool,f.database);f.failCommit=true;
    await assert.rejects(applyWorkflowRelocation(f.pool,f.database,plan.checksum),/commit_uncertain/);f.failCommit=false;
    assert.equal((await planWorkflowRelocation(f.pool,f.database)).status,'already_applied');
    assert.equal((await applyWorkflowRelocation(f.pool,f.database,plan.checksum)).status,'already_applied');
  }finally{await f.db.close();}
});

test('workflow CLI requires saved plan output and explicit apply checksum',()=>{
  assert.throws(()=>parseCommand(['workflow-plan']),/output_required/);
  assert.throws(()=>parseCommand(['workflow-apply']),/reviewed_checksum_required/);
  assert.equal(parseCommand(['workflow-plan','--out','backup.json']).command,'workflow-plan');
});
