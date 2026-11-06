import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import type {SqlPool} from '../../../integrations/postgres/contracts.mts';
import {createCreationTaskStore} from './postgres-store.mts';
test('local completion reserves only the listed fixture notices before commit; retries do not reset delivery',async()=>{
  for(const local of [[],[306]]){
    const calls:string[]=[];let reserved=false;
    const row={id:1,client_id:306,linkedin_account_id:2,outlook_account_id:3,status:'не начата',version:1,proxy_saved_at:'2026-11-06',proxy_uuid:'proxy',proxy_profile_id:4,created_at:'2026-11-06',updated_at:'2026-11-06'};
    const pool:SqlPool={async end(){},async connect(){return{release(){},async query(sql){calls.push(sql);
      if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
      if(sql.startsWith('SELECT client_id FROM'))return{rows:[{client_id:306}]};
      if(sql.startsWith('SELECT t.*'))return{rows:[{...row}]};
      if(sql.startsWith('SELECT p.state'))return{rows:[{state:{phase:'ready',proxy:{uuid:'proxy'}}}]};
      if(sql.startsWith('SELECT url,login,password'))return{rows:[{url:'https://linkedin.com/in/synthetic',login:'test@example.invalid',password:'synthetic'}]};
      if(sql.startsWith('UPDATE noco.linkedin_creation_task')){row.status='сделана экспертом';row.version++;return{rows:[{...row}]};}
      if(sql.includes("error_code='local_delivery_pending'")){reserved=true;return{rows:[]};}
      return{rows:[]};
    }};}};
    const store=createCreationTaskStore(pool,'unicorn_noco_copy_restore',false,undefined,local);await store.status(1,1,'сделана экспертом');assert.equal(reserved,local.length>0);
    const markers=calls.filter(q=>q.includes("error_code='local_delivery_pending'"));
    if(local.length)assert.ok(calls.indexOf(markers[0])<calls.indexOf('COMMIT'));
    await store.status(1,1,'сделана экспертом');assert.equal(calls.filter(q=>q.includes("error_code='local_delivery_pending'")).length,markers.length);
  }
});
