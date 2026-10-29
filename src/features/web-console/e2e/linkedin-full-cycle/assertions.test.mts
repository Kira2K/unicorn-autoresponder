import {test} from 'node:test';import assert from 'node:assert/strict';import {assertConfirmed,assertReplacement} from './assertions.mts';
const task={id:1,source:'student_intake',linkedin_account_id:11,outlook_account_id:12,status:'выполнение подтверждено'};
test('confirmation evidence rejects stale binding, repeated resets and unsent notification',()=>{
 const s={tasks:[task],linklab:{platform_account_id:11,status:'Новый',profile_filled_count:0,profile_revision:-1,blocked_at:null,profile_first_completed_at:null,new_account_url:null,crm_integration_required:true},cycles:[{}],notices:[{task_id:1,state:'sent'}]};
 assert.doesNotThrow(()=>assertConfirmed(s,1,1));
 for(const patch of [{platform_account_id:10},{profile_filled_count:1},{crm_integration_required:false}])assert.throws(()=>assertConfirmed({...s,linklab:{...s.linklab,...patch}},1,1));
 assert.throws(()=>assertConfirmed({...s,notices:[{task_id:1,state:'pending'}]},1,1));
});
test('replacement must preserve profiles, archive both old accounts and keep LinkLab on the old account',()=>{
 const profiles=[{profile_id:2,state:{uuid:'same'}}],before={tasks:[task],profiles};
 const after={tasks:[task,{id:2,linkedin_account_id:21,outlook_account_id:22}],accounts:[{id:11,__nc_deleted:true,is_banned:true},{id:12,__nc_deleted:true},{id:21},{id:22}],profiles,linklab:{platform_account_id:11}};
 assert.doesNotThrow(()=>assertReplacement(before,after,2));assert.throws(()=>assertReplacement(before,{...after,profiles:[]},2));
});
