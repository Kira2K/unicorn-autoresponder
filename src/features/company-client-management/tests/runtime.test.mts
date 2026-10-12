import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeFixture } from './runtime-fixture.mts';
import { planRuntime,applyRuntime } from '../runtime-migration/index.mts';
import { readPolicies } from '../restrictions/read.mts';
import { hhPolicy } from '../restrictions/hh.mts';
import { planArchive,archiveLegacy } from '../runtime-migration/archive.mts';
test('runtime migration retains free text, company links and unconfirmed history; contextual rules external-only',async()=>{
  const f=await runtimeFixture(false);try {
    const before=(await f.db.query('SELECT * FROM noco.applications')).rows;
    const plan=await planRuntime(f.pool,f.database);
    await assert.rejects(applyRuntime(f.pool,f.database,'bad'));
    await applyRuntime(f.pool,f.database,plan.checksum);
    assert.equal((await applyRuntime(f.pool,f.database,plan.checksum)).status,'already_applied');
    assert.deepEqual((await f.db.query('SELECT * FROM noco.applications')).rows,before);
    const session=await f.pool.connect();
    const external=await readPolicies(session,'external-responses','1','en');
    assert.equal(external.length,5);assert.equal(external.filter(r=>r.company_id).length,2);
    assert.ok(external.some(r=>r.context.storedRestriction==='Unlinked text restriction'));
    await f.db.exec(`INSERT INTO noco.company_restrictions(client_id,scope,reason,instruction) VALUES(1,'contextual','location','Apply only in Paris')`);
    const hh=await readPolicies(session,'hh','1','en');
    const result=hhPolicy(hh)({Id:1},'En');
    assert.equal(result.holdReason,undefined);
    assert.deepEqual(result.companies.map(c=>c.name).sort(),['Comtek','One','Unlinked text restriction']);
    assert.equal((await readPolicies(session,'external-responses','1','en')).length,6);
    await assert.rejects(f.db.exec("INSERT INTO noco.company_restrictions(client_id,reason) VALUES(1,'invalid scope')"));
    const archive=await planArchive(f.pool,f.database);
    await archiveLegacy(f.pool,f.database,archive.checksum);
    assert.equal((await archiveLegacy(f.pool,f.database,archive.checksum)).status,'already_applied');
    await assert.rejects(f.db.exec('DELETE FROM noco.legacy_companies'),/Archived/);
    await assert.rejects(f.db.exec("UPDATE noco.\"Student Records\" SET stop_list_company='Changed'"),/archived/);
    await f.db.exec('UPDATE noco."Student Records" SET stop_list_company=stop_list_company');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM noco.legacy_companies')).rows[0].n,2);
  }finally{await f.db.close();}
});
test('runtime DDL and policy imports roll back together on a failed write',async()=>{
  const f=await runtimeFixture(false);try {
    const p=await planRuntime(f.pool,f.database);f.failOn='INSERT INTO noco.company_restrictions';
    await assert.rejects(applyRuntime(f.pool,f.database,p.checksum));f.failOn='';
    assert.equal((await f.db.query("SELECT to_regclass('company_management.collection_runs') AS name")).rows[0].name,null);
  }finally{await f.db.close();}
});
