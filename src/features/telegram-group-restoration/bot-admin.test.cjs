const {test}=require('node:test'),assert=require('node:assert/strict'),{ensureBotRights,snapshotRights}=require('./bot-admin.cjs');
test('temporary bot rights only grant changeInfo and pinMessages, then restore exact baseline',async()=>{
 const state={};let current={};const writes=[];const creator={getEntity:async()=>({id:'8897025258',bot:true}),getInputEntity:async()=>({})};
 const invoke=async request=>{if(request.className==='channels.GetParticipant')return{participant:{adminRights:current}};writes.push(snapshotRights({adminRights:request.adminRights}));current=request.adminRights;return{};};
 await ensureBotRights(creator,{},state,async()=>{},true,invoke);assert.equal(current.changeInfo,true);assert.equal(current.pinMessages,true);assert.ok(!current.inviteUsers&&!current.addAdmins&&!current.banUsers&&!current.deleteMessages);
 await ensureBotRights(creator,{},state,async()=>{},false,invoke);assert.deepEqual(snapshotRights({adminRights:current}),{});assert.equal(writes.length,2);
});
