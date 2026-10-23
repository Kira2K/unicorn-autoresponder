const {test}=require('node:test'),assert=require('node:assert/strict'),{createSelfJoiner}=require('./self-join.cjs');
test('service self-joins by invitation only, existing membership reconciles without second join',async()=>{
 const state={steps:{invite:{done:true}},invitation:'https://t.me/+test',channel:{id:'42'},chatId:'-1000000000042'};let joined=false,joins=0,verified=0;
 const run=createSelfJoiner({checkInvite:async()=>joined?{className:'ChatInviteAlready',chat:{id:'42'}}:{className:'ChatInvite'},joinInvite:async()=>{joined=true;joins++;},verifyHistory:async()=>{verified++;}});
 assert.equal((await run({},state)).via,'self_invite');await run({},state);assert.equal(joins,1);assert.equal(verified,2);
 await assert.rejects(run({}, {...state,channel:{id:'wrong'}}),/wrong_group/);
 await assert.rejects(run({}, {...state,steps:{}}),/verified_invitation/);
});
