const fs=require('node:fs'),path=require('node:path');
const {fork}=require('node:child_process');
const {auditMarket,finalStatuses}=require('./campaign-audit.cjs');
const {verifyStopped}=require('./verify-stopped.cjs');
const {writeJson}=require('./services.cjs');
function readRecords(file){try{return fs.readFileSync(file,'utf8').split('\n').flatMap(line=>{try{return[JSON.parse(line)]}catch{return[]}});}catch{return [];}}
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
async function superviseMarket(config,market,{dir,recognizer,budget,artifacts,signal,onState=()=>{},forkWorker=fork,
  readRunning=()=>require('../../../integrations/dolphin/local-api.ts').requestLocalDolphin('/browser_profiles/running',{timeoutMs:5000}),
  chromium=require('../../../platform/browser/playwright.ts').loadPlaywright().chromium,
  createSupervisor=require('../captcha/supervisor.ts').createCaptchaSupervisor,pollMs=1000}={}){
  const out=fs.openSync(path.join(dir,market+'-worker.log'),'a');
  const child=forkWorker(path.join(__dirname,'worker.cjs'),[market,dir],{cwd:config.root,env:{...process.env,HH_RUN_CONFIG:JSON.stringify(config)},windowsHide:true,stdio:['ignore',out,out,'ipc']});fs.closeSync(out);
  let manifest,supervisor,ticking=false,ending=false,providerError,stopAt,stopTimer,stopDeadline,rejectStopped,guardAt=0,guardBusy=false,guardPromise=Promise.resolve(),records=[];
  const recognitions=new Set();
  const recognitionAbort=new AbortController();
  const guard=require('./resume-wizard.cjs').createResumeWizardGuard(chromium,event=>fs.appendFileSync(path.join(dir,'interventions.jsonl'),JSON.stringify({at:new Date().toISOString(),...event})+'\n'));
  const requestStop=reason=>{
    providerError??=reason;
    if(stopAt||ending)return;stopAt=Date.now();recognitionAbort.abort();
    if(child.connected)child.send({type:'stop'});
    // Do not kill the worker while it owns browser state. Its normal finally
    // blocks retain ownership of reports, tags and status restoration.
    stopTimer=setTimeout(()=>{if(child.connected)child.send({type:'stop'});},30000);
    stopDeadline=setTimeout(()=>{
      if(child.connected)child.disconnect();child.unref();
      rejectStopped?.(Error('hh_worker_stop_timeout'));
    },90000);
  };
  const abort=()=>requestStop('hh_campaign_cancelled');signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const startedAt=Date.now();
  const timer=setInterval(async()=>{
    if(ticking)return;ticking=true;
    try{
      manifest=readJson(path.join(dir,`manifest-${market}.json`));
      if(!manifest?.ledger){if(Date.now()-startedAt>config.startupTimeoutMs)requestStop('hh_market_startup_timeout');return;}
      const ledger=path.resolve(manifest.ledger);
      if(path.dirname(ledger)!==path.join(config.root,'logs')||!path.basename(ledger).startsWith('orchestrator-run-')){requestStop('hh_ledger_scope_invalid');return;}
      records=readRecords(ledger);
      if(!records.some(r=>r.kind==='run-start')&&manifest.readyTargets?.length!==0&&Date.now()-startedAt>config.startupTimeoutMs)requestStop('hh_market_startup_timeout');
      if(!supervisor){
        supervisor=createSupervisor({chromium,readRecords:()=>records,
          save:async(image,attempt,id)=>artifacts.save(image,attempt,id),
          recognize:(bytes,context)=>{
            const operation=(async()=>{
            let ticket,usage=null;
            try{
              ticket=budget.reserve();
              return await recognizer.recognize(bytes,{signal:AbortSignal.any([context.signal,recognitionAbort.signal]),timeoutMs:context.timeoutMs},value=>{usage=value;});
            }catch(error){requestStop(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'captcha_provider_failed');throw error;}
            finally{
              if(ticket){budget.settle(ticket,usage);fs.appendFileSync(path.join(dir,'recognition-usage.jsonl'),JSON.stringify({market,profileId:context.profileId,attempt:context.attempt,usage,error:providerError??null})+'\n');}
              if(context.artifact)artifacts.erase(context.artifact);
              if(budget.snapshot().closed)requestStop(providerError??'captcha_budget_closed');
            }
            })();
            recognitions.add(operation);void operation.then(()=>recognitions.delete(operation),error=>{requestStop(/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_recognition_cleanup_failed');recognitions.delete(operation);});
            return operation;
          },
          onState:state=>onState({market,active:state.active,recognition:budget.snapshot(),providerError}),
          onResult:job=>fs.appendFileSync(path.join(dir,'captcha-results.jsonl'),JSON.stringify({market,id:job.profileId,result:job.result,at:new Date().toISOString()})+'\n')});
        supervisor.start();
      }
      if(!guardBusy&&Date.now()-guardAt>20000){guardAt=Date.now();guardBusy=true;guardPromise=guard(records).finally(()=>{guardBusy=false;});}
    }catch{requestStop('hh_supervision_failed');}finally{ticking=false;}
  },pollMs);
  let exitCode;
  try{exitCode=await new Promise((resolve,reject)=>{rejectStopped=reject;child.once('error',()=>reject(Error('hh_worker_spawn_failed')));child.once('exit',code=>resolve(code??1));});}
  finally{
    ending=true;clearInterval(timer);clearTimeout(stopTimer);clearTimeout(stopDeadline);signal?.removeEventListener('abort',abort);recognitionAbort.abort();
    let deadline;
    try{await Promise.race([Promise.allSettled([supervisor?.stop(),guardPromise,...recognitions]),new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('hh_supervision_cleanup_timeout')),30000);})]);}
    finally{clearTimeout(deadline);}
  }
  manifest=readJson(path.join(dir,`manifest-${market}.json`));
  records=manifest?.ledger?readRecords(manifest.ledger):[];
  const audit=auditMarket(market,records,manifest),statuses=finalStatuses(records);
  try{audit.runningOwnedProfiles=await verifyStopped(audit.cleanup.map(x=>x.id),{readRunning});if(audit.runningOwnedProfiles.length)audit.cleanupComplete=false;}
  catch{audit.cleanupComplete=false;audit.cleanupVerificationError='Dolphin cleanup read failed';}
  const final=records.findLast(r=>r.kind==='run-exit');
  const emptyMarket=Array.isArray(manifest?.readyTargets)&&manifest.readyTargets.length===0;
  const captchaJobs=readRecords(path.join(dir,'captcha-results.jsonl')).filter(r=>r.market===market);
  const result={exitCode:exitCode===0&&!final&&!emptyMarket?1:exitCode,cleanupComplete:audit.cleanupComplete,providerHealthy:!providerError,providerError,
    deliveryComplete:manifest?.readinessDelivery?.sent===true&&!records.some(r=>/send-failed/.test(r.kind||'')||r.event?.event==='parser logs sending failed')&&!statuses.some(s=>s.telegramError)&&(emptyMarket||final?.latestRunSummaryDelivery?.sent===true),
    confirmed:statuses.reduce((n,s)=>n+Number(s.responseCount??0),0),finalized:statuses.length,ready:manifest?.readyTargets?.length??0,
    clientErrors:audit.broken.filter(x=>!x.readinessBlocked&&!['hh_run_cancelled','hh_market_disabled_before_start'].includes(x.reason)).length,
    uncertainProfileIds:statuses.filter(s=>s.startButtonClicked&&s.responseCount===undefined).map(s=>s.dolphinProfileId),
    captchaSolved:captchaJobs.filter(r=>r.result?.solved&&r.result.attempts>0).length,captchaFailed:captchaJobs.filter(r=>!r.result?.solved).length,
    blocked:manifest?.blockedTargets??[],audit,ledger:manifest?.ledger};
  writeJson(path.join(dir,`result-${market}.json`),result);return result;
}
module.exports={superviseMarket,readRecords,readJson};
