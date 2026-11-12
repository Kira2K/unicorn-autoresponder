const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {loadConfiguration,weekdayAllowed}=require('./config.cjs');
const {applyRuntimeEnvironment,preflight,sendStateReport,deliverStateReport,writeJson}=require('./services.cjs');
const {runCampaign}=require('./campaign.cjs');
const {acquireLease,otherHhProcesses}=require('./lease.cjs');
async function main(args=process.argv.slice(2)){
  let lease,config,dir,state,artifacts,timeout,cleanupConfirmed=true;
  const abort=new AbortController();let stopHandler;
  try{
    config=loadConfiguration(args);if(config.mode!=='full')throw Error('hh_launch_requires_full_preflight');
    if(!weekdayAllowed(config))throw Error('hh_weekend_override_required');
    if(otherHhProcesses().length)throw Error('hh_other_runner_active');
    const runId='hh-supervised-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
    dir=path.join(config.root,'logs',runId);fs.mkdirSync(dir,{recursive:true});lease=acquireLease(dir);
    writeJson(path.join(dir,'owner.json'),{...lease.claim,lockFile:lease.file});
    applyRuntimeEnvironment(config);
    artifacts=require('./artifacts.cjs').createArtifacts(config.root,runId);
    config.recognitionRoot=artifacts.dir;
    const recognizer=require('./recognizer.cjs').createRecognizer(config),budget=require('./budget.cjs').createBudget(config);
    stopHandler=()=>abort.abort();process.once('SIGINT',stopHandler);process.once('SIGTERM',stopHandler);
    timeout=setTimeout(()=>abort.abort(),config.campaignTimeoutMs);
    const save=value=>{state={...value,pid:process.pid,recognition:budget.snapshot(),imageRoot:artifacts.dir};writeJson(path.join(dir,'status.json'),state);};
    state=await runCampaign(config,{
      check:async()=>{
        const ticket=budget.reserve();let result;
        try{
          result=await preflight(config,recognizer);
        }finally{budget.settle(ticket,result?.checks.find(x=>x.name==='codex')?.details?.usage??null);}
        if(budget.snapshot().closed){result.ok=false;result.checks.push({name:'recognition_budget',ok:false,code:'captcha_budget_closed'});}
        writeJson(path.join(dir,'service-checks.json'),result);return result;
      },
      runMarket:async market=>{
        if(abort.signal.aborted)throw Error('hh_campaign_cancelled');
        cleanupConfirmed=false;
        const result=await require('./market.cjs').superviseMarket(config,market,{dir,recognizer,budget,artifacts,signal:abort.signal,
          onState:active=>writeJson(path.join(dir,'progress.json'),{at:new Date().toISOString(),...active})});
        cleanupConfirmed=result.cleanupComplete;return result;
      },save,
      report:async final=>{
        try{artifacts.close();final.imageCleanupComplete=true;}
        catch{final.phase='failed';final.error='captcha_artifact_cleanup_failed';final.imageCleanupComplete=false;cleanupConfirmed=false;}
        const file=path.join(dir,'summary-delivery.json');
        writeJson(file,{state:'intent',at:new Date().toISOString()});
        const b=budget.snapshot();const delivery=await deliverStateReport(config,
          `HH supervised: ${final.phase}${final.error?' / '+final.error:''}.\n`+
          (final.preflight?.checks.filter(x=>!x.ok).map(x=>`${x.name}: ${x.code}`).join('; ')||'')+'\n'+
          final.markets.map(m=>`${m.market}: ${m.confirmed} confirmed minimum; ${m.uncertainProfileIds.length} unknown counts; ${m.finalized} outcomes; ${m.clientErrors} client errors; CAPTCHAs ${m.captchaSolved} solved / ${m.captchaFailed} failed; cleanup ${m.cleanupComplete}; recognizer ${m.providerHealthy?'healthy':'FAILED'}; delivery ${m.deliveryComplete}.`).join('\n')+
          `\nRecognition: ${b.calls} calls, ${b.knownTotalTokens} known tokens, ${b.unknownUsageCalls} calls without usage. Run: ${path.basename(dir)}.`);
        writeJson(file,{state:delivery.sent?'sent':'unconfirmed',at:new Date().toISOString(),...delivery});return delivery.sent;
      }
    });
    return ['complete','completed_with_client_errors'].includes(state.phase)?0:1;
  }catch(error){
    const code=/^[a-z][a-z0-9_]+$/.test(error.message)?error.message:'hh_launch_failed';
    if(config&&dir)writeJson(path.join(dir,'launcher-error.json'),{at:new Date().toISOString(),code});
    if(config&&code!=='hh_weekend_override_required')await sendStateReport(config,'HH launch blocked: '+code).catch(()=>false);
    console.error(code);return 1;
  }finally{
    clearTimeout(timeout);if(stopHandler){process.removeListener('SIGINT',stopHandler);process.removeListener('SIGTERM',stopHandler);}
    artifacts?.close();
    if(lease&&cleanupConfirmed)lease.release();
  }
}
if(require.main===module)main().then(code=>{process.exitCode=code;}).catch(()=>{console.error('hh_launch_failed');process.exitCode=1;});
module.exports={main};
