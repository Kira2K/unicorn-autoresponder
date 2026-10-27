import {test} from 'node:test';import assert from 'node:assert/strict';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import type {SqlPool} from '../../../integrations/postgres/contracts.mts';
import {migrateAccountCycle} from './migrate-cycle.mts';
const env={APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_PORT:'55439',APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',APP_DB_POSTGRES_USER:'fixture',APP_DB_POSTGRES_PASSWORD:'fixture'};
function fixture(ready=false,partial=false,marker=COPY_MARKER){
 const calls:string[]=[];let released=false,closed=false;
 const pool:SqlPool={end:async()=>{closed=true},connect:async()=>({release:()=>{released=true},query:async sql=>{
  calls.push(sql);
  if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker}]};
  if(sql.includes('to_regclass'))return{rows:[{ready}]};
  if(sql.includes('FROM pg_trigger'))return{rows:Array(partial?2:3).fill({})};
  if(sql.includes('session_user AS name'))return{rows:[{name:'fixture'}]};
  return{rows:[]};
 }})};
 return{pool,calls,done:()=>released&&closed};
}
test('cycle release migration defaults to rollback, installs in order, grants narrow rights and is rerunnable',async()=>{
 for(const apply of [false,true])for(const ready of [false,true]){
  const f=fixture(ready);assert.deepEqual(await migrateAccountCycle(env,apply,()=>f.pool),{applied:apply,alreadyInstalled:ready});
  assert.equal(f.calls.includes('COMMIT'),apply);assert.equal(f.done(),true);
  const ddl=f.calls.filter(sql=>sql.includes('CREATE TABLE noco.linkedin_'));
  assert.equal(ddl.length,ready?0:2);
  if(!ready){assert.match(ddl[0],/linkedin_creation_proxy/);assert.match(ddl[1],/linkedin_account_cycles/);assert.ok(ddl.every(sql=>!/^BEGIN;|^COMMIT;/m.test(sql)));}
  assert.ok(f.calls.some(sql=>sql.startsWith('GRANT SELECT ON noco.linkedin_account_cycles')));
  assert.equal(f.calls.some(sql=>/^GRANT .*INSERT.*linkedin_account_cycles/.test(sql)),false);
 }
});
test('partial install or wrong database marker fails before commit and always releases the connection',async()=>{
 const partial=fixture(true,true);await assert.rejects(migrateAccountCycle(env,true,()=>partial.pool),/schema_incomplete/);
 assert.equal(partial.calls.includes('COMMIT'),false);assert.equal(partial.done(),true);
 const wrong=fixture(false,false,'unrelated');await assert.rejects(migrateAccountCycle(env,true,()=>wrong.pool),{code:'database_not_allowed'});
 assert.equal(wrong.calls.some(sql=>sql.includes('CREATE TABLE')),false);assert.equal(wrong.done(),true);
});
test('owner connection can grant the separate Render application role without broadening its ownership',async()=>{
 const f=fixture();await migrateAccountCycle(env,false,()=>f.pool,'unicorn_sql_app');
 const grants=f.calls.filter(sql=>sql.startsWith('GRANT '));
 assert.equal(grants.length,2);assert.ok(grants.every(sql=>sql.endsWith('TO "unicorn_sql_app"')));
 assert.equal(grants.some(sql=>sql.includes('unicorn_noco_copy_owner')),false);
 await assert.rejects(migrateAccountCycle(env,false,()=>f.pool,'bad;role'),/application_role_invalid/);
});
