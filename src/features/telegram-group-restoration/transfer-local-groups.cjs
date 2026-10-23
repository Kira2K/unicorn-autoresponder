const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,read,save,openCreator,sleep,report}=require('./live.cjs');
const {LOCAL_FOLDER,secret}=require('./local-extra-auth.cjs'),{hash}=require('./plan.cjs');
const {readiness}=require('./transfer-owner.cjs'),{selectTargets,bindTarget,FROM}=require('./transfer-selection.cjs');
const manifestFile=path.join(FOLDER,'transfer-local-groups.json'),statusFile=path.join(FOLDER,'transfer-local-groups-status.json');
const receipt=id=>path.join(FOLDER,'transfer-client-'+id+'.json');
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function main(){
 if(process.platform!=='win32')throw Error('local_transfer_windows_only');
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'ownership-transfer-local.lock'));
 try{
  const sessionFile=path.join(LOCAL_FOLDER,'gram.session'),fingerprint=hash(fs.readFileSync(sessionFile));let manifest=read(manifestFile);
  if(!manifest){const plans=read(path.join(FOLDER,'plans.json')),states=new Map(plans.map(p=>[p.clientId,read(path.join(FOLDER,'client-'+p.clientId+'.json'))]));
   if(read(path.join(FOLDER,'settings.json'))?.creatorKey!=='local')throw Error('unexpected_restoration_creator');
   const targets=selectTargets(plans,states,{creatorId:FROM});if(!targets.length)throw Error('no_authorized_transfer_targets');
   manifest={requestedAt:new Date().toISOString(),sessionSha256:fingerprint,targets};save(manifestFile,manifest);
  }
  if(manifest.sessionSha256!==fingerprint)throw Error('transfer_owner_session_changed');
  let lastReason;
  for(;;){
   const identity=read(path.join(LOCAL_FOLDER,'identity.json'));if(identity?.id!==FROM||hash(fs.readFileSync(sessionFile))!==fingerprint)throw Error('transfer_owner_session_changed');
   manifest.targets=manifest.targets.map(t=>bindTarget(t,read(path.join(FOLDER,'client-'+t.clientId+'.json'))));save(manifestFile,manifest);
   const targets=manifest.targets.filter(t=>!t.excluded),blocked=targets.find(t=>read(receipt(t.clientId))?.blocked);
   if(blocked){save(statusFile,{status:'blocked',clientId:blocked.clientId,error:read(receipt(blocked.clientId)).error});return;}
   const pending=targets.filter(t=>!read(receipt(t.clientId))?.done);if(!pending.length){save(statusFile,{status:'complete',groups:targets.length,at:new Date().toISOString()});report('ownership_batch_complete',{groups:targets.length});return;}
   const lock=read(path.join(FOLDER,'batch.lock')),runnerActive=!!lock&&alive(lock.pid),notBefore=Date.parse(identity.authorizedAt)+86400000;
   let reason=Date.now()<notBefore?'session_too_young':runnerActive?'runner_active':pending.some(t=>!t.chatId||!read(path.join(FOLDER,'client-'+t.clientId+'.json'))?.completedAt)?'restoration_incomplete':null;
   if(reason){save(statusFile,{status:'waiting',reason,groups:targets.length,pending:pending.length,notBefore:new Date(notBefore).toISOString(),at:new Date().toISOString()});if(reason!==lastReason){report('ownership_batch_waiting',{reason,groups:targets.length,notBefore:new Date(notBefore).toISOString()});lastReason=reason;}await sleep(50000);continue;}
   let releaseBatch;try{releaseBatch=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));}catch(e){if(e.message==='restoration_already_running'){await sleep(50000);continue;}throw e;}
   const c=openCreator('local');let password='';
   try{
    await c.connect();if(String((await c.getMe()).id)!==FROM)throw Error('transfer_source_identity_mismatch');
    const passwordProvider=async()=>{if(!password)password=await secret('Transfer restored groups to unicorn_service: owner 2FA password');return password;};
    for(const target of pending){const state=read(path.join(FOLDER,'client-'+target.clientId+'.json'));bindTarget(target,state);
     if(!readiness({state,authorizedAt:identity.authorizedAt},target).ready)throw Error('transfer_not_ready');
     const result=await require('./transfer-timur.cjs').execute(state,{client:c,scope:target,receipt:receipt(target.clientId),passwordProvider});
     save(path.join(FOLDER,'transfer-client-'+target.clientId+'-status.json'),{clientId:target.clientId,chatId:target.chatId,status:result.done?'complete':'blocked',error:result.error,retryNotBefore:result.retryNotBefore});
     save(statusFile,{status:result.done?'running':'blocked',groups:targets.length,completed:targets.filter(t=>read(receipt(t.clientId))?.done).length,currentClientId:target.clientId,error:result.error});
     report('ownership_group_result',{clientId:target.clientId,done:!!result.done,error:result.error});
     if(!result.done)return;await sleep(10000);
    }
   }finally{password='';await c.disconnect();releaseBatch();}
  }
 }finally{release();}
}
if(require.main===module)main().catch(e=>{const text=String(e.errorMessage||e.code||e.message),error=/^[\w:-]{1,100}$/.test(text)?text:'ownership_batch_failed';save(statusFile,{status:'stopped',error,at:new Date().toISOString()});report('ownership_batch_stopped',{error});process.exitCode=1;});
