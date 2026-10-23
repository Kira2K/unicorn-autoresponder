const {test}=require('node:test'),assert=require('node:assert/strict');
const {account,bindOwner}=require('./account.cjs'),{sendOwner,findReceipt}=require('./owner-send.cjs'),{hash}=require('./plan.cjs');
test('Kira owns only new groups; switching existing owners is refused',()=>{
 const id=account('kira').id,s={};bindOwner(s,id);assert.equal(s.ownerId,id);
 assert.throws(()=>bindOwner({channel:{}},id),/existing_group_owner_mismatch/);
 assert.throws(()=>bindOwner({ownerId:'8805256389'},id),/group_owner_account_mismatch/);
 assert.throws(()=>account('unknown'),/unknown_restoration_account/);
});
test('local account requires explicit identity and never reuses an existing creator',()=>{
 assert.deepEqual(account('local',{id:'343610488',username:'KiraSamsonova'}),{id:'343610488',username:'KiraSamsonova'});
 assert.throws(()=>account('local'),/invalid_local/);
 assert.throws(()=>account('local',{id:'7586552066',username:'very_evil_unicorn'}),/invalid_local/);
 assert.throws(()=>bindOwner({ownerId:'7586552066',channel:{}},'343610488'),/owner_account_mismatch/);
 const uncreated={ownerId:'7586552066',creationReconciledAt:'verified'};bindOwner(uncreated,'343610488');assert.equal(uncreated.ownerId,'343610488');
 assert.throws(()=>bindOwner({ownerId:'7586552066',creationReconciledAt:'verified',steps:{create:{intentAt:1}}},'343610488'),/owner_account_mismatch/);
});
test('Kira sends and reconciles only allowed authors; same text by wrong account is rejected',async()=>{
 const id=account('kira').id,op={text:'literal',hash:hash('literal')},m={id:42,className:'Message',message:'literal',senderId:id};
 const client={restorationOwnerId:id,sendMessage:async()=>m};
 assert.deepEqual(await sendOwner(op,{client,peer:{}}),{messageId:42,senderId:id});
 assert.equal(findReceipt(op,[m],[id]).senderId,id);assert.throws(()=>findReceipt(op,[m],['8805256389']),/not_unique/);
 client.sendMessage=async()=>({...m,senderId:'8805256389'});await assert.rejects(sendOwner(op,{client,peer:{}}),/identity/);
});
