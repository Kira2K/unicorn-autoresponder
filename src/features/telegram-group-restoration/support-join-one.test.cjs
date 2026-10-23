const {test}=require('node:test'),assert=require('node:assert/strict'),{joinOne}=require('./support-join-one.cjs');
const plan={clientId:'1'},state={chatId:'-1000000000042',channel:{id:'42'},invitation:'https://t.me/+test',steps:{invite:{done:true}},completedAt:'done'};
function setup(){let member=false,calls=0,slots=0;const a={accountId:'8222949251',now:()=>1000,save:async()=>{},waitForSlot:async()=>{},advanceSlot:async()=>{slots++;},checkInvite:async()=>member?{className:'ChatInviteAlready',chat:{id:'42'}}:{className:'ChatInvite'},joinInvite:async()=>{calls++;member=true;},verifyHistory:async()=>{}};return{a,get calls(){return calls;},get slots(){return slots;},setMember:v=>{member=v;}};}
test('support self-joins once; supplied identity is returned and existing membership never imports',async()=>{
 const t=setup(),r=await joinOne(plan,state,{},t.a);assert.equal(r.status,'joined');assert.equal(r.result.userId,t.a.accountId);assert.equal(t.calls,1);assert.equal(t.slots,1);await joinOne(plan,state,r,t.a);assert.equal(t.calls,1);
 const u=setup();u.setMember(true);assert.equal((await joinOne(plan,state,{},u.a)).status,'already_member');assert.equal(u.calls,0);
});
test('explicit waits persist; bare FLOOD stops account; no automatic unknown join repeat',async()=>{
 const t=setup();t.a.joinInvite=async()=>{throw Object.assign(Error(),{errorMessage:'FLOOD_WAIT_60',seconds:60});};const waiting=await joinOne(plan,state,{},t.a);assert.equal(waiting.status,'waiting');assert.equal(waiting.retryAt,62000);assert.equal(waiting.intentAt,undefined);
 t.a.joinInvite=async()=>{throw Object.assign(Error(),{errorMessage:'FLOOD'});};assert.equal((await joinOne(plan,state,{},t.a)).stopAccount,true);
 const u=setup();const uncertain=await joinOne(plan,state,{intentAt:1},u.a);assert.equal(uncertain.error,'support_join_outcome_unresolved');assert.equal(u.calls,0);
});
test('accepted-but-lost membership is reconciled without another import; account mismatch refused',async()=>{
 const t=setup();let calls=0;t.a.joinInvite=async()=>{calls++;t.setMember(true);throw Error('network_lost');};assert.equal((await joinOne(plan,state,{},t.a)).done,true);assert.equal(calls,1);
 await assert.rejects(joinOne(plan,state,{accountId:'other'},t.a),/account_mismatch/);
});
test('generic FLOOD with an explicit duration waits rather than inventing a permanent block',async()=>{
 const t=setup();t.a.joinInvite=async()=>{throw Object.assign(Error(),{errorMessage:'FLOOD',seconds:25});};
 const r=await joinOne(plan,state,{},t.a);assert.equal(r.status,'waiting');assert.equal(r.retryAt,27000);assert.notEqual(r.stopAccount,true);assert.equal(r.intentAt,undefined);
});
