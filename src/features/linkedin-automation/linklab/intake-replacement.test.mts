import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SqlSession} from '../../../integrations/postgres/contracts.mts';
import {syncLinkLabAccount} from './intake.mts';
test('completed replacement retargets only an archived LinkLab account; active bindings and ambiguous candidates remain intact',async()=>{
  for(const variant of ['archived','active','ambiguous']){
    const writes:unknown[][]=[];
    const sql={query:async(query:string,values:unknown[]=[])=>{
      if(query.includes('FROM noco.linklab l'))return{rows:[{client_id:7,platform_account_id:11,account_archived:variant!=='active'}]};
      if(query.includes('chosen WHERE'))return{rows:[{platform_account_id:21,data_issue:variant==='ambiguous'?'linkedin_account_ambiguous':null}]};
      if(query.startsWith('UPDATE noco.linklab ')){writes.push(values);return{rows:[{client_id:7}]};}
      return{rows:[]};
    }} as unknown as SqlSession;
    await syncLinkLabAccount(sql,7);
    assert.deepEqual(writes,variant==='archived'?[[7,21,11]]:[]);
  }
});
