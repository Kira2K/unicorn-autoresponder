const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {superviseMarket}=require('./market.cjs'),{createBudget}=require('./budget.cjs');
async function fixture({failProvider=false,running=false,deliveryFailure=false,recognitionDelay=0}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hh-market-test-')),dir=path.join(root,'logs/hh-supervised-test'),ledger=path.join(root,'logs/orchestrator-run-fixture.jsonl');fs.mkdirSync(dir,{recursive:true});
 const events=[{kind:'client-lifecycle',dolphinProfileId:12,event:{event:'automation profile lock planned',details:'status 5, previous 9'}},{kind:'client-lifecycle',dolphinProfileId:12,event:{event:'Dolphin profile started',details:'port 5555'}}];
 fs.writeFileSync(ledger,events.map(e=>JSON.stringify(e)).join('\n')+'\n');fs.writeFileSync(path.join(dir,'manifest-Ru.json'),JSON.stringify({ledger,readyTargets:[{}],blockedTargets:[],readinessDelivery:{sent:true}}));
 const calls=[],budget=createBudget({maxCalls:10,tokenBudget:100000,reserveTokens:10000});
 const forkWorker=()=>{const child=new EventEmitter();child.connected=true;child.send=m=>{calls.push(m.type);finish();};child.disconnect=()=>{};child.unref=()=>{};
  let done=false;function finish(){if(done)return;done=true;clearTimeout(timer);events.push({kind:'client-final-status',status:{clientName:'Fixture',dolphinProfileId:12,responseCount:2,profileStopped:true,profileTagRemoved:true,profileTagVerifiedAfterRemove:true,profileStatusRestored:true}}, {kind:'run-exit',latestRunSummaryDelivery:{sent:true}});if(deliveryFailure)events.push({kind:'client-lifecycle-send-failed'});fs.writeFileSync(ledger,events.map(e=>JSON.stringify(e)).join('\n')+'\n');setTimeout(()=>child.emit('exit',0),2);}
  const timer=setTimeout(finish,40);return child;};
 const createSupervisor=deps=>({start(){void deps.recognize(Buffer.from('fixture'),{signal:new AbortController().signal,timeoutMs:1000,profileId:12,attempt:1,artifact:'owned.png'}).catch(()=>{});},stop:async()=>{calls.push('supervisor-stop');}});
 const recognizer={recognize:async(_b,_c,onUsage)=>{if(recognitionDelay)await new Promise(r=>setTimeout(r,recognitionDelay));if(failProvider)throw Error('captcha_cli_missing');onUsage({input_tokens:7,output_tokens:1});return 'two words';}};
 try{return {result:await superviseMarket({root,startupTimeoutMs:1000},'Ru',{dir,recognizer,budget,artifacts:{erase:f=>{assert.equal(f,'owned.png');calls.push('erase');}},forkWorker,chromium:{},createSupervisor,pollMs:2,readRunning:async()=>running?{12:{}}:{}}),calls,budget:budget.snapshot()};}
 finally{assert.ok(root.startsWith(path.join(os.tmpdir(),'hh-market-test-')));fs.rmSync(root,{recursive:true,force:true});}
}
test('worker completion is audited independently from model usage and cleanup',async()=>{
 const r=await fixture();assert.equal(r.result.confirmed,2);assert.equal(r.result.cleanupComplete,true);assert.equal(r.result.providerHealthy,true);assert.equal(r.result.deliveryComplete,true);assert.equal(r.budget.knownTotalTokens,8);assert.equal(r.calls.filter(x=>x==='erase').length,1);
});
test('failed native recognition requests graceful worker stop; zero usage cannot masquerade as healthy',async()=>{
 const r=await fixture({failProvider:true});assert.equal(r.result.providerHealthy,false);assert.equal(r.result.cleanupComplete,true);assert.equal(r.result.providerError,'captcha_cli_missing');assert.equal(r.budget.unknownUsageCalls,1);assert.ok(r.calls.includes('stop'));
});
test('required report failure is visible even when the child exits zero',async()=>{
 const r=await fixture({deliveryFailure:true});assert.equal(r.result.exitCode,0);assert.equal(r.result.deliveryComplete,false);
});

test('worker exit drains in-flight recognition/accounting before artifact ownership is released',async()=>{
 const r=await fixture({recognitionDelay:80});assert.equal(r.budget.knownTotalTokens,8);assert.equal(r.budget.pending,0);assert.equal(r.calls.filter(x=>x==='erase').length,1);
});
