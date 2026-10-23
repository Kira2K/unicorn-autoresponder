const {test}=require('node:test'),assert=require('node:assert/strict'),{createPreparationGate}=require('./preparation-gate.cjs');
test('other groups wait for service self-join plus confirmed bot messages, without full replay completion',async()=>{
 const gate=createPreparationGate('90');let started=false;const other=gate.before('2',false).then(()=>{started=true;});await new Promise(r=>setImmediate(r));assert.equal(started,false);
 const s={clientId:'90',steps:{unicorn_join_early:{result:{joined:true,historyVerified:true}}},deliveries:{x:{done:true,result:{senderId:'8897025258'}}}};
 gate.prepared(s);await other;assert.equal(started,true);assert.equal(s.completedAt,undefined);
 const failed=createPreparationGate('90'),waiting=failed.before('2',false);failed.failed('90');await assert.rejects(waiting,/pilot_preparation_failed/);
 assert.throws(()=>createPreparationGate('90').prepared({...s,deliveries:{}}),/not_verified/);
});
