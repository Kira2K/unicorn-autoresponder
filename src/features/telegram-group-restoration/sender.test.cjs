const {test}=require('node:test'),assert=require('node:assert/strict'),{bindSender}=require('./sender.cjs');
test('one bot pilot never changes owner-sent groups and sender stays fixed on resume',()=>{
 const settings={sender:'owner',senderOverrides:{'177':'bot'}},a={},b={};
 assert.equal(bindSender(a,settings,'177'),'bot');assert.equal(bindSender(b,settings,'34'),'owner');
 a.deliveries={x:{done:true}};assert.throws(()=>bindSender(a,{sender:'owner'},'177'),/sender_changed/);
 assert.equal(bindSender({senderMode:'owner'},{sender:'bot'},'new'),'bot');
 assert.throws(()=>bindSender({senderMode:'owner',deliveries:{x:{intentAt:1}}},{sender:'bot'},'new'),/sender_changed/);
 assert.throws(()=>bindSender({deliveries:{x:{done:true}}},settings,'177'),/unsent_group/);
 assert.throws(()=>bindSender({}, {sender:'invalid'},'1'),/invalid/);
});
