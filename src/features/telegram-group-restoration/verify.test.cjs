const {test}=require('node:test'),assert=require('node:assert/strict'),{hash}=require('./plan.cjs'),{restoredCopies}=require('./verify.cjs');
test('automatic support-bot greeting is preserved but does not count as restored history',()=>{
 const p={sourceChatId:'-1',operations:[{hash:hash('#src_1_1 old')},{hash:hash('notice')}]};const m=(id,message)=>({id,message,className:'Message',senderId:'8897025258'});
 const rows=[m(1,'welcome'),m(2,'#src_1_1 old'),m(3,'notice')];assert.deepEqual(restoredCopies(p,rows).map(m=>m.id),[2,3]);assert.throws(()=>restoredCopies(p,[...rows,m(4,'notice')]),/count/);assert.throws(()=>restoredCopies(p,[...rows,m(4,'#src_1_1 changed')]),/unexpected/);
});
