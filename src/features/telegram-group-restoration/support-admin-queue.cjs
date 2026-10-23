const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,openCreator,sleep,report,Api,bi}=require('./live.cjs');
const {grantOne}=require('./support-admin-one.cjs');
const ACCOUNT='8222949251',folder=path.join(FOLDER,'support-admin',ACCOUNT),joinFolder=path.join(FOLDER,'support-self-join',ACCOUNT);
const lock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock;
async function main(){
 if(process.platform!=='win32')throw Error('local_support_windows_only');
 fs.mkdirSync(folder,{recursive:true});const release=lock(path.join(FOLDER,'support-admin.lock'));
 try{
  const targets=read(path.join(joinFolder,'manifest.json')).targets;
  const stateFiles=new Map(require('./restored-targets.cjs').collectTargets([FOLDER,path.join(REPO,'storage/group-restoration-additional')],read).map(r=>[r.plan.clientId,r.stateFile]));
  save(path.join(folder,'manifest.json'),{accountId:ACCOUNT,targets,rights:require('./support-admin-one.cjs').DESIRED});
  const file=id=>path.join(folder,'client-'+id+'.json');
  function snapshot(status){const groups=targets.map(t=>({...t,status:read(file(t.clientId))?.done?'admin':read(file(t.clientId))?.status||'waiting',error:read(file(t.clientId))?.error}));save(path.join(folder,'report.json'),{at:new Date().toISOString(),accountId:ACCOUNT,status,groups});return groups;}
  let pilot=read(path.join(folder,'pilot.json'))?.done;
  for(;;){
   const pending=targets.filter(t=>!read(file(t.clientId))?.done);if(!pending.length){snapshot('complete');return;}
   snapshot('running');let progress=false;
   for(const t of pending){
    if(!pilot&&t.clientId!=='76')continue;
    // The owner can verify existing membership even while invite checks of the
    // support account are throttled. This never imports or adds a participant.
    const previous=read(file(t.clientId))||{},membership=read(path.join(joinFolder,'client-'+t.clientId+'.json'));
    if(previous.retryAt>Date.now()&&!(previous.status==='waiting_membership'&&(membership?.done||membership?.accepted)))continue;
    let releaseBatch;try{releaseBatch=lock(path.join(FOLDER,'batch.lock'));}catch(e){if(e.message==='restoration_already_running')break;throw e;}
    let c;
    try{
     const state=read(stateFiles.get(t.clientId));
     if(!state||state.chatId!==t.chatId||state.skipped)throw Error('support_admin_target_mismatch');
     const transferred=read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.done;
     const owner=transferred?'8805256389':state.ownerId||'8805256389';
     const key={'8805256389':'unicorn','7586552066':'kira','343610488':'local'}[owner];if(!key)throw Error('support_admin_unknown_owner');
     c=openCreator(key);await c.connect();if(String((await c.getMe()).id)!==owner)throw Error('support_admin_owner_mismatch');
     const dialogs=await c.getDialogs({limit:300}),entity=dialogs.find(d=>String(d.id)===t.chatId)?.entity;
     if(!entity?.creator)throw Error('support_admin_not_owner');
     const channel=await c.getInputEntity(entity),user=await c.getEntity('veu_support');if(String(user.id)!==ACCOUNT||user.bot)throw Error('support_admin_identity_mismatch');
     const participant=await c.getInputEntity(user);
     await grantOne(previous,{accountId:ACCOUNT,chatId:t.chatId,sleep,save:async r=>save(file(t.clientId),r),getParticipant:async()=> (await c.invoke(new Api.channels.GetParticipant({channel,participant}))).participant,promote:(rights,rank)=>c.invoke(new Api.channels.EditAdmin({channel,userId:participant,adminRights:new Api.ChatAdminRights(rights),rank}))});
     progress=true;report('support_admin_verified',{clientId:t.clientId});
     if(!pilot){pilot=true;save(path.join(folder,'pilot.json'),{done:true,clientId:t.clientId,chatId:t.chatId,at:new Date().toISOString()});report('support_admin_pilot_passed',{clientId:t.clientId});}
    }catch(e){
     const raw=String(e.errorMessage||e.code||e.message),error=/^[\w:-]{1,120}$/.test(raw)?raw:'support_admin_failed';
     const r=read(file(t.clientId))||{accountId:ACCOUNT,chatId:t.chatId};r.error=error;r.status='error';
     if(error==='USER_NOT_PARTICIPANT'){r.status='waiting_membership';r.retryAt=Date.now()+3600000;save(file(t.clientId),r);snapshot('running');await sleep(4000);continue;}
     const seconds=Number(e.seconds||error.match(/^FLOOD_WAIT_(\d+)$/)?.[1]||0);
     if(seconds){r.retryAt=Date.now()+seconds*1000;r.status='waiting';save(file(t.clientId),r);snapshot('waiting_flood');await c?.disconnect();c=null;releaseBatch();releaseBatch=null;await sleep(50000);break;}
     save(file(t.clientId),r);snapshot('blocked');report('support_admin_stopped',{clientId:t.clientId,error});return;
    }finally{await c?.disconnect();releaseBatch?.();}
    snapshot('running');if(process.argv.includes('--pilot-only'))return;await sleep(60000);
   }
   if(!progress)await sleep(50000);
  }
 }finally{release();}
}
if(require.main===module)main().catch(e=>{report('support_admin_queue_failed',{error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'support_admin_failed'});process.exitCode=1;});
