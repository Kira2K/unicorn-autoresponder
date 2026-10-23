const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildPlan,NOTICE}=require('./plan.cjs');const {runJob,runQueue,ordered}=require('./runner.cjs');
test('per-chat pacing is two seconds and concurrency above eight is rejected',async()=>{
 const p=plan([]),s={};let savedDelay;
 await runJob(p,s,{save:async()=>{if(s.deliveries?.['notice:v1']?.done&&!savedDelay)savedDelay=s.nextSendAt-Date.now();},sleep:async()=>{},stage:async()=>({}),send:async()=>({messageId:1})});
 assert.ok(savedDelay>=1900&&savedDelay<=2000);await assert.rejects(runQueue([],async()=>{},9),/invalid_concurrency/);
});
function plan(messages){return buildPlan({group:{id:1,chat_id:'-1',client_name:'Test'},messages,users:new Map(),cutoff:100,renderParts:m=>['#author\n01.01.2026 GMT+4\n\n'+m.id],media:f=>f});}
test('all recent pins inline once; current old pin is first, other old pins excluded',()=>{
 const p=plan([{id:'1',date:10,pinned:true},{id:'2',date:90,pinned:true},{id:'3',date:110}]);assert.deepEqual(p.operations.map(o=>o.sourceId||'notice'),['2','3','notice']);assert.equal(p.pins,1);assert.equal(p.operations.at(-1).text,NOTICE);assert.ok(!p.operations.at(-1).pin);
 const q=plan([{id:'1',date:10,pinned:true},{id:'2',date:100,pinned:true},{id:'3',date:110,pinned:true}]);assert.deepEqual(q.operations.map(o=>o.sourceId||'notice'),['2','3','notice']);assert.equal(q.pins,2);
});
test('attachments pin the last component, one copy per source, stable plans',()=>{
 const input=[{id:'1',date:100,pinned:true,files:[{policy:{keep:true},name:'test.pdf',path:'/fake',bytes:2,sha256:'x'}]}];const p=plan(input);assert.equal(p.operations[0].pin,undefined);assert.equal(p.operations[1].pin,true);assert.equal(p.planHash,plan(input).planHash);
});
test('eight workers, small groups first, failures isolated',async()=>{let active=0,max=0;const jobs=ordered(Array.from({length:30},(_,i)=>({clientId:String(i),sourceMessages:30-i})));assert.equal(jobs[0].clientId,'29');const r=await runQueue(jobs,async j=>{active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;if(j.clientId==='1')throw Error('blocked');});assert.equal(max,8);assert.equal(r.filter(r=>!r.ok).length,1);});
test('visibility before sends, pin inline, final notice once and resume no duplicates',async()=>{const p=plan([{id:'1',date:100,pinned:true}]),s={},events=[];const a={save:async()=>{},sleep:async()=>{},stage:async n=>{events.push(n);return{}},send:async op=>{events.push(op.key);return{messageId:events.length}},pin:async op=>{events.push('pin:'+op.key)},reconcile:async()=>null};await runJob(p,s,a);await runJob(p,s,a);assert.ok(events.indexOf('history')<events.indexOf(p.operations[0].key));assert.ok(events.indexOf('pin:'+p.operations[0].key)<events.indexOf('notice:v1'));assert.equal(events.filter(e=>e==='notice:v1').length,1);assert.ok(events.indexOf('verify')<events.indexOf('sql'));});
test('accepted but lost send only reconciles; missing match blocks',async()=>{const p=plan([]),s={deliveries:{'notice:v1':{intentAt:1}}};let sends=0;const a={save:async()=>{},sleep:async()=>{},stage:async()=>({}),send:async()=>{sends++;return{}},reconcile:async()=>null};await assert.rejects(runJob(p,s,a),/unresolved/);assert.equal(sends,0);a.reconcile=async()=>({messageId:42});await runJob(p,s,a);assert.equal(sends,0);await assert.rejects(runJob({...p,planHash:'other'},s,a),/plan_changed/);});
test('explicit 429 waits before retry and completed sends are not repeated',async()=>{const p=plan([]),s={},waits=[];let sends=0;await runJob(p,s,{save:async()=>{},sleep:async ms=>waits.push(ms),stage:async()=>({}),send:async()=>++sends===1?{retryAfter:9}:{messageId:1},reconcile:async()=>null});assert.equal(sends,2);assert.ok(waits.includes(10000));assert.ok(s.completedAt);});
test('explicit stage rejection can retry, transport uncertainty retains reconciliation intent',async()=>{
 const p=plan([]),s={};let rejected=true;
 const a={save:async()=>{},sleep:async()=>{},stage:async n=>{if(n==='create'&&rejected)throw Object.assign(Error(),{errorMessage:'FLOOD'});return{};},send:async()=>({messageId:1})};
 await assert.rejects(runJob(p,s,a));assert.equal(s.steps.create.intentAt,undefined);
 a.stage=async n=>{if(n==='create')throw Error('connection_lost');return{};};await assert.rejects(runJob(p,s,a));assert.ok(s.steps.create.intentAt);
});
