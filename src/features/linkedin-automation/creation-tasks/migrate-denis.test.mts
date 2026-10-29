import {test} from 'node:test';import assert from 'node:assert/strict';
import {migrateDenisWorkflow} from './migrate-denis.mts';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
test('Denis migration defaults to rollback and backfills only exact expert proxy receipts',async()=>{
 for(const apply of [false,true]){
  const calls:string[]=[];
  const open=()=>({connect:async()=>({release(){},query:async(sql:string)=>{calls.push(sql);return{rows:sql.includes('current_database()')?[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]:sql.includes('AS count')?[{count:2}]:[]};}}),end:async()=>{}});
  const result=await migrateDenisWorkflow({APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_PORT:'55439',APP_DB_POSTGRES_USER:'fixture',APP_DB_POSTGRES_PASSWORD:'fixture'},apply,open as any);
  assert.deepEqual(result,{applied:apply,matchedExpertProxies:2});
  assert.equal(calls.includes('COMMIT'),apply);
  const ddl=calls.find(sql=>sql.includes('ALTER TABLE noco.platform_accounts'))!;
  assert.match(ddl,/is_banned boolean NOT NULL DEFAULT false/);assert.match(ddl,/proxy_is_made_by_expert boolean NOT NULL DEFAULT false/);
  assert.match(ddl,/t\.proxy_uuid=p\.state->'proxy'->>'uuid'/);assert.match(ddl,/t\.client_id=p\.client_id/);assert.doesNotMatch(ddl,/UPDATE noco\.linklab/);
 }
});
