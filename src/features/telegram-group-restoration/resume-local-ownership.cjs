// Authorized ownership transfer only. No messages, joins, or SQL writes.
const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,read,save,openCreator,sleep,report,Api}=require('./live.cjs');
const {secret,LOCAL_FOLDER}=require('./local-extra-auth.cjs');
const {readiness}=require('./transfer-owner.cjs');
const {hash}=require('./plan.cjs');
const statusFile=path.join(FOLDER,'transfer-local-groups-status.json');
async function batchLock(){for(;;){try{return require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));}catch(e){if(e.message!=='restoration_already_running')throw e;await sleep(10000);}}}
async function main(){
 const unlock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'ownership-transfer-local.lock'));
 let password='';
 try{
  const manifest=read(path.join(FOLDER,'transfer-local-groups.json')),identity=read(path.join(LOCAL_FOLDER,'identity.json'));
  if(manifest.targets.length!==10||identity.id!=='343610488'||manifest.sessionSha256!==hash(fs.readFileSync(path.join(LOCAL_FOLDER,'gram.session'))))throw Error('ownership_manifest_mismatch');
  const targets=[...manifest.targets].sort((a,b)=>Number(b.clientId==='143')-Number(a.clientId==='143'));
  const pending=targets.filter(t=>!read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.done);
  if(!pending.length){save(statusFile,{at:new Date().toISOString(),status:'complete',groups:10,completed:10});return;}
  if(pending.some(t=>read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.blocked))throw Error('ownership_previous_attempt_blocked');
  for(const t of targets)if(!readiness({state:read(path.join(FOLDER,'client-'+t.clientId+'.json')),authorizedAt:identity.authorizedAt},t).ready)throw Error('ownership_not_ready');
  const raw=fs.readFileSync(statusFile);if(raw.length&&raw.every(b=>b===0))fs.writeFileSync(path.join(FOLDER,'transfer-status-corrupt-20261017.bin'),raw);
  const release=await batchLock(),c=openCreator('local');
  try{await c.connect();if(String((await c.getMe()).id)!=='343610488')throw Error('ownership_identity_mismatch');if(!(await c.invoke(new Api.account.GetPassword())).hasPassword)throw Error('ownership_2fa_missing');}finally{await c.disconnect();release();}
  save(statusFile,{at:new Date().toISOString(),status:'waiting_local_password',groups:10,completed:10-pending.length});report('ownership_local_input_required',{groups:pending.length});
  // No Telegram session or global queue lock is held while the user types.
  password=await secret('Ownership transfer: @KiraSamsonova 2FA password (local only)');
  for(const target of pending){
   const receipt=path.join(FOLDER,'transfer-client-'+target.clientId+'.json'),previous=read(receipt);if(previous?.done)continue;if(previous?.blocked)throw Error('ownership_previous_attempt_blocked');
   save(statusFile,{at:new Date().toISOString(),status:'running',groups:10,completed:targets.filter(t=>read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.done).length,currentClientId:target.clientId});
   const release=await batchLock(),c=openCreator('local');let result;
   try{await c.connect();result=await require('./transfer-timur.cjs').execute(read(path.join(FOLDER,'client-'+target.clientId+'.json')),{client:c,scope:target,receipt,passwordProvider:async()=>password});}
   finally{await c.disconnect();release();}
   save(path.join(FOLDER,'transfer-client-'+target.clientId+'-status.json'),{at:new Date().toISOString(),clientId:target.clientId,status:result.done?'complete':'blocked',error:result.error,retryNotBefore:result.retryNotBefore});
   const completed=targets.filter(t=>read(path.join(FOLDER,'transfer-client-'+t.clientId+'.json'))?.done).length;
   save(statusFile,{at:new Date().toISOString(),status:result.done?'running':'blocked',groups:10,completed,currentClientId:target.clientId,error:result.error,retryNotBefore:result.retryNotBefore});report('ownership_retry_result',{clientId:target.clientId,done:!!result.done,error:result.error});
   if(!result.done)return;await sleep(60000);
  }
  save(statusFile,{at:new Date().toISOString(),status:'complete',groups:10,completed:10});
 }finally{password='';unlock();}
}
if(require.main===module)main().catch(e=>{const raw=String(e.errorMessage||e.code||e.message),error=/^[\w:-]{1,120}$/.test(raw)?raw:'ownership_retry_failed';save(statusFile,{at:new Date().toISOString(),status:'stopped',error});report('ownership_retry_stopped',{error});process.exitCode=1;});
