const {test}=require('node:test'),assert=require('node:assert/strict');
const {recoverOwnedProfiles}=require('./recovery.cjs');
const rows=[{kind:'client-lifecycle',dolphinProfileId:12,event:{event:'automation profile lock planned',details:'status 5, previous 9'}}];
function fixture(){const profile={status:{id:5},tags:['keep','Автоотклики, не трогай']};let running=true;const writes=[];return {writes,profile,ports:{readProfile:async()=>structuredClone(profile),readRunning:async()=>running?{12:{},99:{}}:{99:{}},stop:async id=>{assert.equal(id,12);writes.push('stop');running=false;},removeTag:async(id,tag)=>{assert.equal(id,12);writes.push('tag');profile.tags=profile.tags.filter(x=>x!==tag);},restoreStatus:async(id,status)=>{assert.equal(id,12);writes.push('status');profile.status={id:status};}}};}
test('restart inspection is read-only; explicit recovery changes only proven owned profile',async()=>{
 const f=fixture();assert.equal((await recoverOwnedProfiles(rows,f.ports)).cleanupComplete,false);assert.deepEqual(f.writes,[]);
 assert.equal((await recoverOwnedProfiles(rows,f.ports,true)).cleanupComplete,true);assert.deepEqual(f.writes,['stop','tag','status']);assert.deepEqual(f.profile.tags,['keep']);assert.equal(f.profile.status.id,9);
});
test('changed ownership and missing lock evidence never trigger cleanup',async()=>{
 const f=fixture();f.profile.status.id=77;const r=await recoverOwnedProfiles(rows,f.ports,true);assert.equal(r.cleanupComplete,false);assert.equal(r.profiles[0].error,'hh_recovery_ownership_changed');assert.deepEqual(f.writes,[]);
 assert.equal((await recoverOwnedProfiles([{kind:'client-lifecycle',dolphinProfileId:13,event:{event:'Dolphin profile started'}}],f.ports,true)).cleanupComplete,false);
});
test('a partially applied tag can be recovered without inventing a previous status',async()=>{
 const f=fixture();f.profile.status.id=9;f.ports.readRunning=async()=>({});
 assert.equal((await recoverOwnedProfiles(rows,f.ports,true)).cleanupComplete,true);assert.deepEqual(f.writes,['tag','status']);
});
