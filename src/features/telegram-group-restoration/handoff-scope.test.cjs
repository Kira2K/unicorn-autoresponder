const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectMarket,assertTarget,authorizedTransfer}=require('./handoff-scope.cjs');
const target={clientId:'24',chatId:'-1004499955012',planHash:'frozen'};
test('market selection uses only matching secured restoration groups, never original IDs',()=>{
 const rows=[{id:'24',client_status:'on en market',secured_general_chat_id:target.chatId},{id:'2',client_status:'on ru market',secured_general_chat_id:' ',telegram_general_chat_id:target.chatId},{id:'3',client_status:'studying',secured_general_chat_id:target.chatId},{id:'4',client_status:'on ru market',secured_general_chat_id:'-100999'}];
 const r=selectMarket(rows,[target]);assert.deepEqual(r.targets.map(t=>t.clientId),['24']);assert.deepEqual(r.skipped.map(t=>t.reason),['no_secured_group','not_restored_target']);
});
test('SQL rebinding and wrong restoration plan fail before mutation',()=>{
 assert.doesNotThrow(()=>assertTarget(target,{id:'24',secured_general_chat_id:target.chatId},{clientId:'24',chatId:target.chatId,planHash:'frozen',completedAt:'done'}));
 assert.throws(()=>assertTarget(target,{id:'24',secured_general_chat_id:'-100999'},{clientId:'24',chatId:target.chatId,planHash:'frozen',completedAt:'done'}),/secured_scope_changed/);
 assert.throws(()=>authorizedTransfer({...target,from:'343610488',to:'8805256389'},[target]),/unauthorized/);
 assert.equal(authorizedTransfer({...target,from:'7586552066',to:'8805256389'},[target]).from,'7586552066');
});
