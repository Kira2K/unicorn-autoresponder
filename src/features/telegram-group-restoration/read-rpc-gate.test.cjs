const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadGate}=require('./read-rpc-gate.cjs');
test('mixed client never retries a failed ownership write',async()=>{
 let calls=0;const gate=require('./read-rpc-gate.cjs').paceReadCalls({sleep:async()=>{},invoke:async()=>{calls++;throw Object.assign(Error(),{errorMessage:'FLOOD',seconds:25});}});
 await assert.rejects(gate({className:'channels.EditCreator'}));assert.equal(calls,1);
});
test('history pagination is paced and an explicit wait retries the same read only',async()=>{
 let now=0,calls=0;const starts=[],waits=[];
 const gate=createReadGate({now:()=>now,sleep:async ms=>{now+=ms;},invoke:async r=>{starts.push(now);if(++calls===2)throw Object.assign(Error(),{errorMessage:'FLOOD',seconds:25});return r.className;},onWait:r=>waits.push(r)});
 assert.equal(await gate({className:'messages.GetHistory'}),'messages.GetHistory');await gate({className:'messages.GetHistory'});
 assert.deepEqual(starts,[0,3100,29100]);assert.equal(waits[0].seconds,25);
});
test('bare flood has no invented retry and writes are refused',async()=>{
 let calls=0;const gate=createReadGate({sleep:async()=>{},invoke:async()=>{calls++;throw Object.assign(Error(),{errorMessage:'FLOOD'});}});
 await assert.rejects(gate({className:'channels.EditCreator'}),/read_rpc_required/);assert.equal(calls,0);
 await assert.rejects(gate({className:'messages.GetHistory'}));assert.equal(calls,1);
});
