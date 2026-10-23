const {test}=require('node:test'),assert=require('node:assert/strict'),{createGate}=require('./create-gate.cjs');
test('nine queued creates serialize, persist cooldown and resume it after failure',async()=>{
 let clock=100,next=0,active=0,max=0;const at=[];
 const make=()=>createGate({load:async()=>next,save:async t=>{next=t;},now:()=>clock,sleep:async ms=>{clock+=ms;}});
 const gate=make();await Promise.all(Array.from({length:9},()=>gate(async()=>{active++;max=Math.max(max,active);at.push(clock);await Promise.resolve();clock+=200;active--;})));
 assert.equal(max,1);for(let i=1;i<at.length;i++)assert.ok(at[i]-at[i-1]>=60000);
 await assert.rejects(gate(async()=>{throw Error('rejected');}));const saved=next;const resumed=make();await resumed(async()=>assert.ok(clock>=saved));
});
