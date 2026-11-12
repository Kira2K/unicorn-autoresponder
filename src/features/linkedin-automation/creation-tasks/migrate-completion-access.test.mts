import {test} from 'node:test';import assert from 'node:assert/strict';
import {COPY_MARKER,type SqlPool} from '../../../integrations/postgres/contracts.mts';
import {migrateCompletionAccess} from './migrate-completion-access.mts';
const env={APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_PORT:'55439',APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',APP_DB_POSTGRES_USER:'fixture',APP_DB_POSTGRES_PASSWORD:'fixture'};
function fixture(marker=COPY_MARKER,fail=false){
 const calls:string[]=[];let released=false,closed=false;
 const pool={end:async()=>{closed=true},connect:async()=>({release(){released=true},async query(sql:string){
  calls.push(sql);if(sql.includes('current_database()')&&sql.trimStart().startsWith('SELECT'))return{rows:[{database:'unicorn_noco_copy_restore',marker}]};
  if(fail&&sql.includes('DO $migration$'))throw Error('guard drift');return{rows:[]};
 }})}as SqlPool;
 return{pool,calls,done:()=>released&&closed};
}
test('access migration defaults to rollback, changes only installed guards and commits explicitly',async()=>{
 for(const apply of [false,true]){
  const f=fixture();assert.deepEqual(await migrateCompletionAccess(env,apply,()=>f.pool),{applied:apply});
  assert.equal(f.calls.includes('COMMIT'),apply);assert.equal(f.done(),true);
  assert.ok(f.calls.includes('SET LOCAL ROLE unicorn_noco_copy_owner'));
  const ddl=f.calls.find(q=>q.includes('DO $migration$'))!;
  assert.match(ddl,/pg_get_functiondef/);assert.match(ddl,/linkedin_completion_guard_unrecognized/);
  assert.doesNotMatch(ddl,/DISABLE TRIGGER|\b(?:UPDATE|DELETE FROM|INSERT INTO)\s+noco\./i);
 }
});
test('unrecognized database or failed predicate check never commits and always releases',async()=>{
 for(const [marker,fail]of [['unrelated',false],[COPY_MARKER,true]] as const){
  const f=fixture(marker,fail);await assert.rejects(migrateCompletionAccess(env,true,()=>f.pool));
  assert.equal(f.calls.includes('COMMIT'),false);assert.equal(f.done(),true);
 }
});
