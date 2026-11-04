import { createHash,randomUUID } from 'node:crypto';
export const failure = code => Object.assign(new Error(code), {code});
const assert = (ok,code) => {if(!ok)throw failure(code);};
export function parseConfig(value) {
 const c=structuredClone(value);let url;
 try{url=new URL(c.backendUrl);}catch{throw failure('bridge_invalid_config');}
 assert((url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))&&
  !url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&
  /^[a-z0-9_-]{1,60}$/.test(c.bridgeId??'')&&/^[A-Za-z0-9_-]{43,128}$/.test(c.secret??'')&&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.ownerEmail??'')&&Array.isArray(c.allowedProfileUuids)&&
  (c.allowedProfileUuids.length>0||c.allowAllManagedProfiles===true)&&
  c.allowedProfileUuids.every(id=>/^[a-f0-9]{32}$/.test(id)),'bridge_invalid_config');
 c.backendUrl=url.origin;c.ownerEmail=c.ownerEmail.toLowerCase();c.pollMilliseconds??=2000;
 assert(Number.isInteger(c.pollMilliseconds)&&c.pollMilliseconds>=1000&&c.pollMilliseconds<=30000,'bridge_invalid_config');
 return c;
}
const taskDigest=t=>createHash('sha256').update(JSON.stringify([t.version,t.bridgeId,t.id,t.uuid,t.password,t.ownerEmail,t.expiresAt,t.hiddenAt])).digest('hex');
const transportReason=error=>{
 const code=error?.cause?.code??error?.code;
 if(error?.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code))return'timeout';
 if(error?.name==='AbortError')return'aborted';
 if(['ENOTFOUND','EAI_AGAIN'].includes(code))return'dns';
 if(code==='ECONNREFUSED')return'connection_refused';
 if(['ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(code))return'connection_reset';
 return'network';
};
export function createAgent({config:input,journal,fetchImpl=fetch,now=Date.now,log=()=>{}}) {
 const config=parseConfig(input);let work,retryAt=0,failures=0;
 const emit=event=>{try{log({feature:'octo_bridge',at:now(),...event});}catch{}};
 const responseType=r=>{const type=r.headers?.get?.('content-type')??'';return /json/i.test(type)?'json':/html/i.test(type)?'html':type?'other':'missing';};
 async function backend(path,body,context={}){
  const requestId=randomUUID(),started=now(),operation=path.slice(1);let r,code,reason,backendCode;
  try{
  try{r=await fetchImpl(`${config.backendUrl}/internal/octo-bridge/v1${path}`,{
   method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{authorization:`Bearer ${config.secret}`,'content-type':'application/json','x-octo-request-id':requestId},
   ...(body===undefined?{}:{body:JSON.stringify({...body,deviceId:journal.data.deviceId})})});}
  catch(error){throw Object.assign(failure('bridge_backend_outcome_unknown'),{transportReason:transportReason(error)});}
  let b;try{b=await r.json();}catch{throw failure('bridge_backend_response_unknown');}
  if(!r.ok){const e=failure('bridge_backend_refused');e.status=r.status;
   if(/^octo_[a-z0-9_]{1,100}$/.test(b?.error??''))e.backendCode=b.error;throw e;}
  assert(operation==='authorize'?b?.authorized===true:operation==='result'?b?.accepted===true:
   operation==='health'?b?.ready===true:!!b&&typeof b==='object'&&!Array.isArray(b)&&('task'in b),'bridge_backend_response_unknown');
  return b;
  }catch(e){code=e.code;reason=e.transportReason;backendCode=e.backendCode;throw e;}finally{
   if(code||operation!=='poll')emit({target:'backend',operation,requestId,...context,
    method:body===undefined?'GET':'POST',durationMs:Math.max(0,now()-started),httpStatus:r?.status,responseType:r?responseType(r):'absent',outcome:code??'ok',transportReason:reason,backendCode});
  }
 }
 async function local(path,body,context={}){
  const started=now(),requestId=randomUUID();let r,code,reason;
  try{
  try{r=await fetchImpl(`http://127.0.0.1:58888/api${path}`,{
   method:body?'DELETE':'GET',redirect:'error',signal:AbortSignal.timeout(body?65000:5000),
   ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});}
  catch(error){throw Object.assign(failure(body?'bridge_local_outcome_unknown':'bridge_local_unavailable'),{transportReason:transportReason(error)});}
  let b;try{b=await r.json();}catch{throw failure(body?'bridge_local_outcome_unknown':'bridge_local_unavailable');}
  if(!r.ok||b?.error||b?.error_code||b?.success===false)throw failure('bridge_local_refused');
  if(body)assert(b?.msg==='Profile password has been cleared','bridge_local_outcome_unknown');
  return b;
  }catch(e){code=e.code;reason=e.transportReason;throw e;}finally{
   if(code||body)emit({target:'desktop',operation:body?'clear_password':path==='/username'?'owner':'active',requestId,...context,
    method:body?'DELETE':'GET',durationMs:Math.max(0,now()-started),httpStatus:r?.status,responseType:r?responseType(r):'absent',outcome:code??'ok',transportReason:reason});
  }
 }
 async function preflight(uuid){
  assert((await local('/username')).username?.toLowerCase()===config.ownerEmail,'bridge_wrong_owner');
  if(uuid){const rows=await local('/profiles/active');assert(Array.isArray(rows),'bridge_invalid_active_response');
   assert(!rows.some(p=>p.uuid?.replaceAll('-','')===uuid),'bridge_profile_running');}
 }
 async function flush(id,entry){
  if(!entry.result||entry.acknowledged)return;
  try{assert((await backend('/result',{id,result:entry.result},{grantId:id,profileUuid:entry.uuid})).accepted===true,'bridge_backend_response_unknown');}
  catch(e){if(e.status!==404)throw e;} // A later grant may replace an already-completed one.
  entry.acknowledged=true;await journal.save();
 }
 async function step(){
  for(const [id,entry]of Object.entries(journal.data.entries))await flush(id,entry);
  await preflight();
  const task=(await backend('/poll',{profileUuids:config.allowAllManagedProfiles===true?'managed':config.allowedProfileUuids})).task;
  if(task===null)return{state:'idle'};
  assert(task?.version===1&&task.bridgeId===config.bridgeId&&/^[a-zA-Z0-9_-]{1,100}$/.test(task.id??'')&&/^[a-f0-9]{32}$/.test(task.uuid??'')&&
   (config.allowAllManagedProfiles===true||config.allowedProfileUuids.includes(task.uuid))&&/^\d{5}$/.test(task.password??'')&&task.ownerEmail===config.ownerEmail&&
   Number.isFinite(task.expiresAt)&&Number.isFinite(task.hiddenAt)&&task.hiddenAt>=task.expiresAt&&now()>=task.expiresAt,
  'bridge_invalid_task');
  const digest=taskDigest(task);let entry=journal.data.entries[task.id];
  if(entry){
   assert(entry.digest===digest,'bridge_task_changed');
   if(entry.result){await flush(task.id,entry);return{state:'reported'};}
   if(entry.stage!=='received'){
    entry.result={state:'uncertain',code:'bridge_interrupted_local_write'};await journal.save();await flush(task.id,entry);return{state:'uncertain'};
   }
  }else{entry=journal.data.entries[task.id]={uuid:task.uuid,digest,stage:'received'};await journal.save();}
  await preflight(task.uuid);
  // Still durably "received": no Desktop write can have happened. Replaying
  // this authorization is safe; the server rechecks eligibility for this device.
  // Never convert a missing authorization response into a terminal local receipt.
  assert((await backend('/authorize',{id:task.id},{grantId:task.id,profileUuid:task.uuid})).authorized===true,'bridge_backend_response_unknown');
  entry.stage='executing';await journal.save();
  try{
   await preflight(task.uuid);
   await local('/profiles/password',{uuid:task.uuid,password:task.password},{grantId:task.id,profileUuid:task.uuid});entry.result={state:'succeeded'};
  }catch(e){entry.result={state:e.code==='bridge_local_outcome_unknown'?'uncertain':'rejected',
   code:/^bridge_[a-z0-9_]{1,80}$/.test(e.code??'')?e.code:'bridge_local_failed'};}
  await journal.save();await flush(task.id,entry);return{state:entry.result.state};
 }
 return{
  async check(){await preflight();const b=await backend('/health');assert(b.ready===true&&b.bridgeId===config.bridgeId,'bridge_backend_unavailable');return{ownerVerified:true,backendReady:true};},
  step(){
   if(work)return work;
   if(now()<retryAt)return Promise.resolve({state:'retrying',retryAfterMs:retryAt-now()});
   work=step().then(result=>{failures=0;return result;}).catch(e=>{
    if(/^bridge_backend_/.test(e.code??'')){
     const delay=Math.min(30000,config.pollMilliseconds*2**Math.min(failures++,4));retryAt=now()+delay;e.retryAfterMs=delay;
    }
    throw e;
   }).finally(()=>{work=undefined;});return work;
  }
 };
}
