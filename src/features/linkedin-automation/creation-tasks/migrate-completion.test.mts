import {test} from 'node:test';import assert from 'node:assert/strict';
import {COPY_MARKER,type SqlPool} from '../../../integrations/postgres/contracts.mts';
import {migrateTaskCompletion} from './migrate-completion.mts';
const env={APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_PORT:'55439',APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',APP_DB_POSTGRES_USER:'fixture',APP_DB_POSTGRES_PASSWORD:'fixture'};
function fixture(marker=COPY_MARKER,fail=false){
 const calls:string[]=[];let released=false,closed=false;
 const pool={end:async()=>{closed=true},connect:async()=>({release(){released=true},async query(sql:string){
  calls.push(sql);if(sql.trimStart().startsWith('SELECT')&&sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker}]};
  if(sql.includes('LOCK TABLE')&&fail)throw Error('linkedin_pending_expert_tasks: 42');
  if(sql.startsWith('SELECT count(*)'))return{rows:[{count:0}]};return{rows:[]};
 }})} as SqlPool;
 return{pool,calls,done:()=>released&&closed};
}
test('completion migration defaults to rollback, uses the owner role and only commits explicitly',async()=>{
 for(const apply of [false,true]){
  const f=fixture();assert.deepEqual(await migrateTaskCompletion(env,apply,()=>f.pool),{applied:apply});
  assert.equal(f.calls.includes('COMMIT'),apply);assert.equal(f.done(),true);
  assert.ok(f.calls.includes('SET LOCAL ROLE unicorn_noco_copy_owner'));
  const ddl=f.calls.find(q=>q.includes('LOCK TABLE'))!;assert.ok(ddl);assert.doesNotMatch(ddl,/^BEGIN;|^COMMIT;/m);
 }
});
test('wrong database or pending expert work never commits and always closes the connection',async()=>{
 const wrong=fixture('unrelated');await assert.rejects(migrateTaskCompletion(env,true,()=>wrong.pool),{code:'database_not_allowed'});
 assert.equal(wrong.calls.some(q=>q.includes('LOCK TABLE')),false);assert.equal(wrong.done(),true);
 const pending=fixture(COPY_MARKER,true);await assert.rejects(migrateTaskCompletion(env,true,()=>pending.pool),/linkedin_pending_expert_tasks: 42/);
 assert.equal(pending.calls.includes('COMMIT'),false);assert.equal(pending.done(),true);
});
