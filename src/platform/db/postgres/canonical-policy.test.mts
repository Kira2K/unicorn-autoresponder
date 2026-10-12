import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresAppDb } from './postgres-db.mts';
import { makeFixture,unusedSheets,TABLES } from './test-fixture.mts';
test('canonical PostgreSQL HH policy replaces old source reads and client text without affecting target mapping',async()=>{
  const f=makeFixture();
  const db=createPostgresAppDb(async()=>f.reader,unusedSheets,async()=>()=>({companies:[{id:'canonical',name:'Canonical employer'}]}));
  const targets=await db.getAutomationTargets({workWithRuOnly:false});
  assert.equal(targets.length,3);
  assert.ok(targets.every(t=>t.blockedCompanies?.length===1&&t.blockedCompanies[0].name==='Canonical employer'));
  assert.ok(!f.requests.includes(TABLES.restrictions.id));
  assert.ok(!f.requests.includes('relation'));
});
test('an explicitly absent migration keeps HH on its legacy reader; policy failures never fall back',async()=>{
  const f=makeFixture();
  const db=createPostgresAppDb(async()=>f.reader,unusedSheets,async()=>undefined);
  const targets=await db.getAutomationTargets({market:'En'});
  assert.ok(targets[0].blockedCompanies?.some(c=>c.name==='Local Ltd'));
  assert.ok(f.requests.includes(TABLES.restrictions.id));
  const broken=createPostgresAppDb(async()=>f.reader,unusedSheets,async()=>{throw Error('policy_unavailable');});
  await assert.rejects(broken.getAutomationTargets(),/policy_unavailable/);
});
