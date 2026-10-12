import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeFixture } from './runtime-fixture.mts';
import { planArchive, archiveLegacy } from '../runtime-migration/archive.mts';
import { planRestoreRestrictions, restoreRestrictions } from '../restrictions/restore.mts';
import { readPolicies } from '../restrictions/read.mts';
import { readExistingPolicies } from '../restrictions/existing.mts';
import { hhPolicy } from '../restrictions/hh.mts';
import { planSchema } from '../schema.mts';
import { parseCommand } from '../cli.mts';

test('restore original restrictions without losing policies, applications or editability', async () => {
  const f=await runtimeFixture();
  try {
    const archive=await planArchive(f.pool,f.database); await archiveLegacy(f.pool,f.database,archive.checksum);
    const s=await f.pool.connect(), before=hhPolicy(await readPolicies(s,'hh'))({Id:1},'En');
    const applications=(await f.db.query('SELECT * FROM noco.applications ORDER BY id')).rows;
    const plan=await planRestoreRestrictions(f.pool,f.database);
    assert.equal(plan.backup?.rows.length,5);
    assert.equal((await restoreRestrictions(f.pool,f.database,plan)).status,'applied');
    assert.equal((await restoreRestrictions(f.pool,f.database,plan)).status,'already_applied');
    assert.equal((await planSchema(f.pool,f.database)).status,'applied');
    assert.equal((await planArchive(f.pool,f.database)).status,'restrictions_restored');
    await assert.rejects(archiveLegacy(f.pool,f.database,archive.checksum),/restrictions_already_restored/);
    for(const name of ['company_restrictions','active_restrictions','client_company_summary'])
      assert.equal((await f.db.query('SELECT to_regclass($1) AS name',['noco.'+name])).rows[0].name,null);
    const after=hhPolicy(await readPolicies(s,'hh'))({Id:1},'En');
    assert.deepEqual(after.companies.map(c=>c.name).sort(),before.companies.map(c=>c.name).sort());
    assert.deepEqual((await f.db.query('SELECT * FROM noco.applications ORDER BY id')).rows,applications);
    await f.db.exec(`UPDATE noco."Student Records" SET stop_list_company='New ban' WHERE "Record Id"=1;
      UPDATE noco.legacy_restrictions SET names='Paris only' WHERE id=20;
      DELETE FROM noco.legacy_restriction_links WHERE company_id=11;`);
    const changed=await readPolicies(s,'external-responses','1','en');
    assert.ok(changed.some(r=>r.context.storedRestriction==='New ban'));
    assert.ok(changed.some(r=>r.context.offers==='Paris only'));
    assert.equal(changed.filter(r=>r.scope==='company').length,1);
    assert.equal((await readExistingPolicies(s,'external-responses','1','ru')).length,2);
    assert.equal((await readExistingPolicies(s,'hh','2','en')).length,1);
    assert.ok((await readPolicies(s,'hh')).every(r=>!r.context.offers));
    await assert.rejects(f.db.exec('DELETE FROM noco.legacy_applications'),/Archived/);
    await assert.rejects(f.db.exec('DELETE FROM noco.legacy_companies'),/Archived/);
  } finally { await f.db.close(); }
});

test('refuse to discard rules missing from original sources or changed after backup',async()=>{
  const f=await runtimeFixture();
  try {
    const plan=await planRestoreRestrictions(f.pool,f.database);
    await f.db.exec("UPDATE noco.company_restrictions SET instruction='Changed'");
    await assert.rejects(restoreRestrictions(f.pool,f.database,plan),/restriction_equivalence_failed/);
    await assert.rejects(planRestoreRestrictions(f.pool,f.database),/restriction_equivalence_failed/);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM noco.company_restrictions')).rows[0].n,5);
  } finally {await f.db.close();}
});

test('failure rolls back drops; lost commit acknowledgement can be reconciled from the receipt',async()=>{
  const f=await runtimeFixture();
  try {
    const plan=await planRestoreRestrictions(f.pool,f.database);
    f.failOn='INSERT INTO company_management.schema_migrations';
    await assert.rejects(restoreRestrictions(f.pool,f.database,plan));f.failOn='';
    assert.equal((await f.db.query('SELECT count(*)::int n FROM noco.company_restrictions')).rows[0].n,5);
    f.failCommit=true;
    await assert.rejects(restoreRestrictions(f.pool,f.database,plan),/commit_uncertain/);f.failCommit=false;
    assert.equal((await restoreRestrictions(f.pool,f.database,plan)).status,'already_applied');
  } finally {await f.db.close();}
});

test('backup changes and inactive rules block cleanup; CLI requires a saved backup',async()=>{
  assert.throws(()=>parseCommand(['restrictions-restore-plan']),/output_required/);
  assert.throws(()=>parseCommand(['restrictions-restore-apply','--expect-checksum','a'.repeat(64)]),/input_required/);
  assert.throws(()=>parseCommand(['restrictions-restore-apply','--input','backup.json']),/reviewed_checksum_required/);
  const f=await runtimeFixture();
  try {
    const plan=await planRestoreRestrictions(f.pool,f.database);
    await f.db.exec("UPDATE noco.company_restrictions SET source=source||'{\"extra\":true}'::jsonb");
    await assert.rejects(restoreRestrictions(f.pool,f.database,plan),/restriction_backup_changed/);
    await f.db.exec("UPDATE noco.company_restrictions SET active_from=now()+interval '1 day'");
    await assert.rejects(planRestoreRestrictions(f.pool,f.database),/restriction_equivalence_failed/);
  } finally {await f.db.close();}
});
