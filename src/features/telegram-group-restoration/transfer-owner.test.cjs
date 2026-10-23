const {test}=require('node:test'),assert=require('node:assert/strict');
const {SCOPE,readiness,transferOnce}=require('./transfer-owner.cjs');
const state={clientId:'143',chatId:SCOPE.chatId,ownerId:SCOPE.from,completedAt:'done'};
test('transfer waits for full restoration, 24-hour session and idle runner; other groups refused',()=>{
 const input={state,authorizedAt:'2026-10-15T00:00:00Z',now:Date.parse('2026-10-16T00:00:00Z')};
 assert.equal(readiness(input).ready,true);assert.equal(readiness({...input,now:input.now-1}).reason,'session_too_young');
 assert.equal(readiness({...input,state:{...state,completedAt:null}}).reason,'restoration_incomplete');
 assert.equal(readiness({...input,runnerActive:true}).reason,'runner_active');
 assert.throws(()=>readiness({...input,state:{...state,clientId:'144'}}),/scope_mismatch/);
});
function adapters(){let owner=SCOPE.from,calls=0,saved;const a={now:()=>1000,inspect:async()=>({ownerId:owner,serviceMember:true,digest:'baseline'}),prepare:async()=>({secret:'memory-only'}),transfer:async()=>{calls++;owner=SCOPE.to;},verify:async baseline=>assert.equal(baseline,'baseline'),save:async r=>{saved=r;}};return{a,get calls(){return calls;},get saved(){return saved;},setOwner:v=>{owner=v;}};}
test('one transfer, idempotent completion, no password or SRP in receipt',async()=>{
 const t=adapters(),r=await transferOnce({},t.a);assert.equal(r.done,true);assert.equal(t.calls,1);assert.equal(JSON.stringify(r).includes('memory-only'),false);
 await transferOnce(r,t.a);assert.equal(t.calls,1);
});
test('batch scope stays per-group and rejects receipt reuse or another source account',async()=>{
 const t=adapters(),scope={...SCOPE,clientId:'149',chatId:'-1003989554785'};
 const r=await transferOnce({},t.a,scope);assert.equal(r.clientId,'149');assert.equal(r.chatId,scope.chatId);
 await assert.rejects(transferOnce(r,t.a,SCOPE),/receipt_scope_mismatch/);
 await assert.rejects(transferOnce({},t.a,{...scope,from:'7586552066'}),/scope_mismatch/);
});
test('explicit Telegram restriction records wait and never automatically retries',async()=>{
 const t=adapters();t.a.transfer=async()=>{throw Object.assign(Error(),{errorMessage:'SESSION_TOO_FRESH_3600'});};const r=await transferOnce({},t.a);
 assert.equal(r.blocked,true);assert.equal(r.retryNotBefore,3601000);t.a.transfer=async()=>{throw Error('must_not_retry');};assert.equal(await transferOnce(r,t.a),r);
});
test('new source requires an explicitly matching authorized scope; old contract remains strict',async()=>{
 const scope={...SCOPE,from:'7586552066',planHash:'frozen'},t=adapters();t.setOwner(scope.from);t.a.authorizedScope=scope;
 assert.equal((await transferOnce({},t.a,scope)).done,true);
 await assert.rejects(transferOnce({}, {...t.a,authorizedScope:{...scope,chatId:'-100999'}},scope),/scope_mismatch/);
});
test('uncertain transfer reconciles owner; a stored intent never causes another ownership write',async()=>{
 const t=adapters();t.a.transfer=async()=>{t.setOwner(SCOPE.to);throw Error('connection_lost');};assert.equal((await transferOnce({},t.a)).done,true);
 const u=adapters();const blocked=await transferOnce({intentAt:1,baseline:'baseline'},u.a);assert.equal(blocked.error,'transfer_outcome_unresolved');assert.equal(u.calls,0);
 u.setOwner(SCOPE.to);assert.equal((await transferOnce({intentAt:1,baseline:'baseline'},u.a)).reconciled,true);assert.equal(u.calls,0);
});
