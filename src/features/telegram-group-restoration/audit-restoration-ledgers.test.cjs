const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('./audit-restoration-ledgers.cjs'),{hash}=require('./plan.cjs');
test('completion with a missing publication or pin is rejected',()=>{
 const plan={planHash:'p',operations:[{key:'x',text:'a',hash:hash('a'),pin:true}]};
 const s={planHash:'p',completedAt:'now',steps:{final_verify:{done:true,result:{historyVisible:true}}}};
 assert.deepEqual(inspect(plan,s).issues,['completed_missing_delivery']);
 s.deliveries={x:{done:true,hash:hash('a'),result:{messageId:1}}};
 assert.deepEqual(inspect(plan,s).issues,['completed_missing_pin']);
 s.steps['pin:x']={done:true};assert.deepEqual(inspect(plan,s).issues,[]);
});
test('a gap followed by a receipt is flagged; excluded groups remain excluded',()=>{
 const p={planHash:'p',operations:[{key:'a',text:'a',hash:hash('a')},{key:'b',text:'b',hash:hash('b')}]};
 assert.ok(inspect(p,{planHash:'p',deliveries:{b:{done:true,hash:hash('b'),result:{messageId:2}}}}).issues.includes('delivery_after_gap'));
 assert.deepEqual(inspect(p,{skipped:true}),{status:'skipped',issues:[]});
});
