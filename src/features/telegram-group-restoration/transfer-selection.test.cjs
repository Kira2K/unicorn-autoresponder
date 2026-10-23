const {test}=require('node:test'),assert=require('node:assert/strict'),{selectTargets,bindTarget,FROM}=require('./transfer-selection.cjs');
test('only groups of KiraSamsonova and her uncreated archive jobs enter transfer scope',()=>{
 const plans=['1','2','3','4','5'].map(clientId=>({clientId,planHash:'h'}));
 const states=new Map([['1',{channel:{},ownerId:FROM,chatId:'-1001'}],['2',{channel:{},ownerId:'7586552066',completedAt:'done'}],['3',{skipped:true}],['4',{completedAt:'done'}]]);
 const selected=selectTargets(plans,states,{creatorId:FROM});assert.deepEqual(selected.map(s=>s.clientId),['1','5']);
 assert.equal(selectTargets(plans,states,{creatorId:'7586552066'}).length,1);
 const scope={clientId:'5',planHash:'h',chatId:null},state={clientId:'5',planHash:'h',ownerId:FROM,chatId:'-1000000000042',channel:{id:'42'}};
 assert.equal(bindTarget(scope,state).chatId,state.chatId);assert.throws(()=>bindTarget(scope,{...state,ownerId:'7586552066'}),/scope_changed/);
 assert.throws(()=>bindTarget({...scope,chatId:'-1000000000099'},state),/scope_changed/);
 assert.equal(bindTarget(scope,{skipped:true}).excluded,true);
});
