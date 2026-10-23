const {test}=require('node:test'),assert=require('node:assert/strict'),{deliverOnce}=require('./delivery.cjs');
test('one file; accepted-but-lost result reconciles and never duplicates',async()=>{
 let receipt={},sends=0;const adapters={save:async r=>{receipt=r;},send:async()=>{sends++;throw Error('response_lost');},reconcile:async()=>({messageId:42})};
 await assert.rejects(deliverOnce(receipt,'sha',adapters));assert.equal(sends,1);const done=await deliverOnce(receipt,'sha',adapters);assert.equal(done.messageId,42);await deliverOnce(done,'sha',adapters);assert.equal(sends,1);await assert.rejects(deliverOnce(done,'changed',adapters),/changed/);
});
