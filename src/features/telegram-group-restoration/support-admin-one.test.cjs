const {test}=require('node:test'),assert=require('node:assert/strict');
const {grantOne,DESIRED}=require('./support-admin-one.cjs');
test('promotes existing member, preserves previous rights, verifies and reconciles without duplicate',async()=>{
 let participant={adminRights:{addAdmins:true}},writes=0,stored;
 const a={accountId:'8222949251',chatId:'-1001',getParticipant:async()=>participant,save:async r=>stored=structuredClone(r),promote:async rights=>{writes++;participant={adminRights:rights};}};
 const result=await grantOne({},a);assert.equal(result.done,true);assert.equal(participant.adminRights.addAdmins,true);assert.equal(writes,1);
 await grantOne(stored,a);assert.equal(writes,1);
});
test('uncertain promotion is read back and never repeated blindly',async()=>{
 let participant={},writes=0,stored;
 const a={accountId:'8222949251',chatId:'-1001',getParticipant:async()=>participant,save:async r=>stored=structuredClone(r),promote:async()=>{writes++;throw Error('connection_lost');}};
 await assert.rejects(grantOne({},a),/connection_lost/);await assert.rejects(grantOne(stored,a),/outcome_unresolved/);assert.equal(writes,1);
 participant={adminRights:DESIRED};assert.equal((await grantOne(stored,a)).done,true);
});
test('wrong account and absent membership cannot trigger a promotion',async()=>{
 let writes=0;const a={accountId:'8222949251',chatId:'-1001',getParticipant:async()=>{throw Error('USER_NOT_PARTICIPANT');},promote:async()=>writes++};
 await assert.rejects(grantOne({accountId:'8897025258'},a),/account_mismatch/);
 await assert.rejects(grantOne({},a),/USER_NOT_PARTICIPANT/);assert.equal(writes,0);
});
test('banned and departed participants are never promoted or implicitly added',async()=>{
 let writes=0;
 for(const className of ['ChannelParticipantBanned','ChannelParticipantLeft'])await assert.rejects(grantOne({},{accountId:'8222949251',chatId:'-1001',getParticipant:async()=>({className}),promote:async()=>writes++}),/USER_NOT_PARTICIPANT/);
 assert.equal(writes,0);
});
test('delayed rights become visible through reads without another promotion',async()=>{
 let reads=0,writes=0,waits=0;
 const result=await grantOne({},{accountId:'8222949251',chatId:'-1001',save:async()=>{},getParticipant:async()=>++reads<3?{}:{adminRights:DESIRED},promote:async()=>writes++,sleep:async ms=>{assert.equal(ms,1000);waits++;}});
 assert.equal(result.done,true);assert.equal(writes,1);assert.equal(waits,1);
});
