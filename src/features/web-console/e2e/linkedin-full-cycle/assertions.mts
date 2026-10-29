import assert from 'node:assert/strict';
export function assertConfirmed(snapshot:any,taskId:number,expectedCycles:number){
 const task=snapshot.tasks.find((t:any)=>Number(t.id)===taskId);assert.equal(task.status,'выполнение подтверждено');
 assert.equal(Number(snapshot.linklab.platform_account_id),Number(task.linkedin_account_id));assert.equal(snapshot.linklab.status,'Новый');
 assert.equal(snapshot.linklab.profile_filled_count,0);assert.equal(Number(snapshot.linklab.profile_revision),-1);
 assert.equal(snapshot.linklab.blocked_at,null);assert.equal(snapshot.linklab.profile_first_completed_at,null);assert.equal(snapshot.linklab.new_account_url,null);
 assert.equal(snapshot.linklab.crm_integration_required,true);assert.equal(snapshot.cycles.length,expectedCycles);
 assert.equal(snapshot.notices.length,expectedCycles);assert.equal(snapshot.notices.find((n:any)=>Number(n.task_id)===taskId).state,'sent');
}
export function assertReplacement(before:any,after:any,newTaskId:number){
 const old=before.tasks.filter((t:any)=>t.status==='выполнение подтверждено'&&Number(t.id)!==newTaskId).at(-1)||before.tasks.find((t:any)=>t.source==='student_intake'),fresh=after.tasks.find((t:any)=>Number(t.id)===newTaskId);
 assert.ok(old&&fresh);assert.notEqual(String(old.id),String(fresh.id));
 for(const key of ['linkedin_account_id','outlook_account_id']){
  assert.notEqual(String(old[key]),String(fresh[key]));assert.equal(after.accounts.find((a:any)=>String(a.id)===String(old[key])).__nc_deleted,true);
  assert.equal(!!after.accounts.find((a:any)=>String(a.id)===String(fresh[key])).__nc_deleted,false);
 }
 assert.equal(after.accounts.find((a:any)=>String(a.id)===String(old.linkedin_account_id)).is_banned,true);
 assert.deepEqual(after.profiles.map((p:any)=>[p.profile_id,p.state.uuid]),before.profiles.map((p:any)=>[p.profile_id,p.state.uuid]));
 assert.equal(Number(after.linklab.platform_account_id),Number(old.linkedin_account_id),'intake does not switch LinkLab');
}
