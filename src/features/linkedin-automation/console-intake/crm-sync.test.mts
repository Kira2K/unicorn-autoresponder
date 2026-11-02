import {test} from 'node:test';import assert from 'node:assert/strict';
import {COPY_MARKER} from '../../../integrations/postgres/contracts.mts';
import type {SqlPool,SqlSession} from '../../../integrations/postgres/contracts.mts';
import {linkedInCrmSyncStore,markConsoleAccountCreation} from './crm-sync.mts';
import {guardAccount} from '../creation-tasks/account-guard.mts';

test('CRM flag reads expose booleans only and startup rejects a missing trigger without DDL',async()=>{
 const calls:string[]=[];let ready=true;
 const pool={end:async()=>{},connect:async()=>({release(){},async query(sql:string){calls.push(sql);
  if(sql.includes('current_database()'))return{rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
  if(sql.includes('AS ready'))return{rows:[{ready}]};
  if(sql.includes('JOIN noco.platforms'))return{rows:[{id:'11',isUnsyncedWithCRM:true,password:'private'},{id:'12',isUnsyncedWithCRM:false}]};
  return{rows:[]};}})}as SqlPool;
 const store=linkedInCrmSyncStore(pool,'unicorn_noco_copy_restore');await store.checkSchema();
 assert.deepEqual(await store.readFlags([11,12]),[{id:11,isUnsyncedWithCRM:true},{id:12,isUnsyncedWithCRM:false}]);
 const before=calls.length;assert.deepEqual(await store.readFlags([]),[]);assert.equal(calls.length,before);
 ready=false;await assert.rejects(store.checkSchema(),{code:'linkedin_crm_sync_schema_required'});
 assert.ok(!calls.some(sql=>/^\s*(CREATE|ALTER|INSERT|UPDATE|DELETE)/.test(sql)));
});

test('console source marker is transaction-local; generic account edits never set it',async()=>{
 const calls:string[]=[];let platform='linkedin';
 const s={release(){},async query(sql:string){calls.push(sql);
  if(sql.includes('SELECT clients_id,platforms_id'))return{rows:[{clients_id:7,platforms_id:16}]};
  if(sql.includes('SELECT lower(name)'))return{rows:[{name:platform}]};return{rows:[]};}}as SqlSession;
 await markConsoleAccountCreation(s);assert.match(calls.pop()!,/set_config\('unicorn.console_account_creation','1',true\)/);
 await guardAccount(s,undefined,{clients_id:7,platforms_id:16});assert.equal(calls.filter(sql=>sql.includes('set_config')).length,1);
 calls.length=0;await guardAccount(s,['11']);assert.ok(!calls.some(sql=>sql.includes('set_config')));
 platform='email_outlook';await guardAccount(s,undefined,{clients_id:7,platforms_id:31});assert.ok(!calls.some(sql=>sql.includes('set_config')));
});
