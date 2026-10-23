const {test}=require('node:test'),assert=require('node:assert/strict'),{createRpcGate}=require('./rpc-gate.cjs');
test('bare FLOOD is explicit rejection: cooldown serializes account RPC without resending uncertain calls',async()=>{
 let clock=0,attempt=0,stored=0;const waits=[];const request={className:'channels.EditPhoto'};
 const gate=createRpcGate({now:()=>clock,sleep:async ms=>{clock+=ms;},load:()=>0,save:n=>{stored=n;},onWait:w=>waits.push(w),invoke:async()=>{if(attempt++===0)throw{errorMessage:'FLOOD'};return'true';}});
 assert.equal(await gate(request),'true');assert.equal(attempt,2);assert.ok(clock>=60000);assert.equal(waits[0].seconds,60);assert.ok(stored>=clock);
 let calls=0;const uncertain=createRpcGate({invoke:async()=>{calls++;throw Error('transport_lost');},sleep:async()=>{}});await assert.rejects(uncertain(request),/transport_lost/);assert.equal(calls,1);
});
