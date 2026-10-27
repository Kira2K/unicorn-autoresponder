import { createHash } from 'node:crypto';
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
export function createAgent({config:input,journal,fetchImpl=fetch,now=Date.now}) {
 const config=parseConfig(input);let work;
 async function backend(path,body){
  let r;try{r=await fetchImpl(`${config.backendUrl}/internal/octo-bridge/v1${path}`,{
   method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(30000),
   headers:{authorization:`Bearer ${config.secret}`,'content-type':'application/json'},
   ...(body===undefined?{}:{body:JSON.stringify({...body,deviceId:journal.data.deviceId})})});}
  catch{throw failure('bridge_backend_outcome_unknown');}
  let b;try{b=await r.json();}catch{throw failure('bridge_backend_response_unknown');}
  if(!r.ok){const e=failure('bridge_backend_refused');e.status=r.status;
   if(/^octo_[a-z0-9_]{1,100}$/.test(b?.error??''))e.backendCode=b.error;throw e;}
  return b;
 }
 async function local(path,body){
  let r;try{r=await fetchImpl(`http://127.0.0.1:58888/api${path}`,{
   method:body?'DELETE':'GET',redirect:'error',signal:AbortSignal.timeout(body?65000:5000),
   ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});}
  catch{throw failure(body?'bridge_local_outcome_unknown':'bridge_local_unavailable');}
  let b;try{b=await r.json();}catch{throw failure(body?'bridge_local_outcome_unknown':'bridge_local_unavailable');}
  if(!r.ok||b?.error||b?.error_code||b?.success===false)throw failure('bridge_local_refused');
  if(body)assert(b?.msg==='Profile password has been cleared','bridge_local_outcome_unknown');
  return b;
 }
 async function preflight(uuid){
  assert((await local('/username')).username?.toLowerCase()===config.ownerEmail,'bridge_wrong_owner');
  if(uuid){const rows=await local('/profiles/active');assert(Array.isArray(rows),'bridge_invalid_active_response');
   assert(!rows.some(p=>p.uuid?.replaceAll('-','')===uuid),'bridge_profile_running');}
 }
 async function flush(id,entry){
  if(!entry.result||entry.acknowledged)return;
  try{assert((await backend('/result',{id,result:entry.result})).accepted===true,'bridge_backend_response_unknown');}
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
  try{assert((await backend('/authorize',{id:task.id})).authorized===true,'bridge_backend_response_unknown');}
  catch(e){
   if(e.status&&e.backendCode!=='octo_bridge_already_authorized')throw e; // Explicit refusal: no local write occurred.
   entry.stage='uncertain';entry.result={state:'uncertain',code:'bridge_authorization_outcome_unknown'};
   await journal.save();await flush(task.id,entry);return{state:'uncertain'};
  }
  entry.stage='executing';await journal.save();
  try{
   await preflight(task.uuid);
   await local('/profiles/password',{uuid:task.uuid,password:task.password});entry.result={state:'succeeded'};
  }catch(e){entry.result={state:e.code==='bridge_local_outcome_unknown'?'uncertain':'rejected',
   code:/^bridge_[a-z0-9_]{1,80}$/.test(e.code??'')?e.code:'bridge_local_failed'};}
  await journal.save();await flush(task.id,entry);return{state:entry.result.state};
 }
 return{
  async check(){await preflight();const b=await backend('/health');assert(b.ready===true&&b.bridgeId===config.bridgeId,'bridge_backend_unavailable');return{ownerVerified:true,backendReady:true};},
  step(){if(work)return work;work=step().finally(()=>{work=undefined;});return work;}
 };
}
