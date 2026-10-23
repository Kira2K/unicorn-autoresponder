const fs=require('node:fs'),path=require('node:path');
const {loadPlans}=require('./archive.cjs');
const {ordered,runQueue}=require('./runner.cjs');
const {concurrency,perChatDelayMs}=require('./limits.cjs');
const {ROOT,REPO,FOLDER,read,save,report,openCreator,creatorIdentity,restore,sleep,rpc,Api}=require('./live.cjs');
function prepare(){
 fs.mkdirSync(FOLDER,{recursive:true});
 const file=path.join(FOLDER,'plans.json');let plans=read(file);
 if(!plans){plans=loadPlans(ROOT);if(plans.length!==114||new Set(plans.map(p=>p.clientId)).size!==114)throw Error('archive_scope_mismatch');save(file,plans);}
 const jobs=ordered(plans.filter(p=>p.clientId!=='92'));
 const manifest={version:2,total:plans.length,concurrency,createConcurrency:1,createDelayMs:60000,perChatDelayMs,cutoff:plans[0].cutoff,jobs:jobs.map(p=>({clientId:p.clientId,sourceChatId:p.sourceChatId,sourceMessages:p.sourceMessages,operations:p.operations.length,pins:p.pins,planHash:p.planHash}))};
 save(path.join(FOLDER,'manifest.json'),manifest);return{plans,jobs};
}
function safeCode(e){const v=String(e.errorMessage||e.code||e.message||'operation_failed');return /^[a-zA-Z0-9_:-]{1,120}$/.test(v)?v:'operation_failed';}
async function snapshot(plans){
 const result={at:new Date().toISOString(),groups:plans.map(p=>{const s=p.clientId==='92'?read(path.join(FOLDER,'galina-preserved.json')):read(path.join(FOLDER,'client-'+p.clientId+'.json'));return{clientId:p.clientId,sourceChatId:p.sourceChatId,chatId:s?.chatId,status:s?.complete||s?.completedAt?'complete':s?.skipped?'skipped':s?'in_progress':'pending',skipReason:s?.skipReason,messages:s?.messages??Object.values(s?.deliveries||{}).filter(d=>d.done).length,total:s?.skipped?0:p.operations.length,archivedTotal:p.operations.length,pins:p.pins,visibility:!!s?.steps?.history?.done||!!s?.historyVisible,error:s?.complete||s?.completedAt?undefined:s?.lastError};})};
 save(path.join(FOLDER,'report.json'),result);return result;
}
async function main({execute=false}={}){
 const prepared=prepare(),plans=prepared.plans;await require('./graduates-live.cjs').prepareGraduates(plans);
 const jobs=prepared.jobs.filter(p=>!read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.skipped);
 const manifest=read(path.join(FOLDER,'manifest.json'));manifest.excluded=plans.filter(p=>read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.skipped).map(p=>({clientId:p.clientId,reason:'graduated'}));manifest.jobs=manifest.jobs.filter(p=>!manifest.excluded.some(e=>e.clientId===p.clientId));save(path.join(FOLDER,'manifest.json'),manifest);
 report('batch_prepared',{groups:plans.length,jobs:jobs.length,operations:jobs.reduce((n,p)=>n+p.operations.length,0),concurrency});
 const audience=require('./delivery.cjs').audience;
 const roles=await audience(plans.filter(p=>!read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.skipped).map(p=>({...p,invitation:'pending'})));
 save(path.join(FOLDER,'audience-review.json'),{people:roles.people.map(p=>({id:p.id,name:p.name,username:p.username,groups:p.groups.length})),unresolved:roles.unresolved});
 report('audience_preflight',{knownStaff:roles.people.length,unresolved:roles.unresolved.length});
 if(!execute){await snapshot(plans);return;}
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));
 const creatorKey=read(path.join(FOLDER,'settings.json'))?.creatorKey||'unicorn',identity=creatorIdentity(creatorKey);
 const c=openCreator(creatorKey);let timer,botAdmin,service,joinUnicorn,preparationGate;
 try{
  await c.connect();const me=await c.getMe();if(String(me.id)!==identity.id||me.username!==identity.username)throw Error('creator_mismatch');
  if(creatorKey==='local'){
   service=openCreator('unicorn');await service.connect();if(String((await service.getMe()).id)!=='8805256389')throw Error('service_identity_mismatch');
   joinUnicorn=require('./self-join.cjs').createSelfJoiner({checkInvite:token=>rpc(service,new Api.messages.CheckChatInvite({hash:token})),joinInvite:token=>rpc(service,new Api.messages.ImportChatInvite({hash:token})),verifyHistory:async(plan,state,chat,{partial=false}={})=>{const peer=await service.getInputEntity(chat),messages=[];for await(const m of service.iterMessages(peer,{}))messages.push(m);const checkedPlan=partial?{...plan,operations:plan.operations.filter(o=>state.deliveries?.[o.key]?.done)}:plan;const copies=require('./verify.cjs').restoredCopies(checkedPlan,messages,[state.ownerId,'8897025258']);if(copies.some((m,i)=>m.id!==state.deliveries[checkedPlan.operations[i].key].result.messageId))throw Error('self_join_history_receipt_mismatch');}});
  }
  const {createTelegramIntegration}=await import('file:///'+REPO.replace(/\\/g,'/')+'/src/integrations/telegram/integration.ts');
  if(String(process.env.VEU_SUPPORT_BOT||'').split(':')[0]!=='8897025258')throw Error('bot_mismatch');
  const telegram=createTelegramIntegration({regularErrorChatId:'',summaryLogsChatId:'',logger(){},requestTimeoutMs:120000});
  if(process.env.RESTORATION_BOT_ADMIN==='1'){
   const {api}=require(ROOT+'/tools/creator-auth.cjs');
   botAdmin=await require('./bot-admin.cjs').openBotAdmin({...api,token:process.env.VEU_SUPPORT_BOT,sessionFile:path.join(FOLDER,'support-admin.session')});
  }
  timer=setInterval(()=>{snapshot(plans).then(r=>report('batch_progress',{complete:r.groups.filter(g=>g.status==='complete').length,skipped:r.groups.filter(g=>g.status==='skipped').length,pending:r.groups.filter(g=>g.status==='pending').length,inProgress:r.groups.filter(g=>g.status==='in_progress').length,failed:r.groups.filter(g=>g.error).length})).catch(()=>report('snapshot_failed'));},60000);
  timer.unref();
  // A live legacy Galina process owns its journal; wait rather than stop it.
  while(!read(ROOT+'/runtime/restoration/client-92.json')?.completedAt){report('waiting_for_galina');await sleep(30000);}
  await require('./galina.cjs').auditGalina(c,telegram);
  async function run(p){try{await preparationGate?.before(p.clientId,!!read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.completedAt);const result=await restore(p,c,telegram,botAdmin,{joinUnicorn,onPrepared:state=>preparationGate?.prepared(state)});await snapshot(plans);return result;}catch(e){preparationGate?.failed(p.clientId);const file=path.join(FOLDER,'client-'+p.clientId+'.json'),s=read(file)||{};s.lastError=safeCode(e);s.lastFailure={at:new Date().toISOString(),code:s.lastError,method:e.rpcMethod||e.request?.className||null};save(file,s);await snapshot(plans);report('group_failed',{clientId:p.clientId,code:s.lastError,method:s.lastFailure.method});throw e;}}
  const pilot=jobs[0];const first=await run(pilot);await require('./new-member-test.cjs').testNewMember(pilot,first);
  for(const p of jobs.slice(1,3))await run(p);
  report('pilot_gate_passed',{pilot:pilot.clientId,firstTwo:jobs.slice(1,3).map(p=>p.clientId),concurrency});
  if(creatorKey==='local'&&read(path.join(FOLDER,'settings.json'))?.parallelAfterSendSmoke){
   const id=read(path.join(FOLDER,'settings.json')).localPilotClientId;
   if(!id)throw Error('local_pilot_id_missing');preparationGate=require('./preparation-gate.cjs').createPreparationGate(id);
   const state=read(path.join(FOLDER,'client-'+id+'.json'));if(state?.completedAt)preparationGate.prepared(state);
  }
  const remaining=jobs.slice(3),existing=remaining.filter(p=>read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.channel),uncreated=remaining.filter(p=>!read(path.join(FOLDER,'client-'+p.clientId+'.json'))?.channel);
  const botPilotId=read(path.join(FOLDER,'settings.json'))?.botPilotClientId;
  let botPilot;
  if(botPilotId&&!read(path.join(FOLDER,'bot-pilot.json'))?.done){botPilot=jobs.find(p=>p.clientId===botPilotId);if(!botPilot)throw Error('bot_pilot_missing');const i=uncreated.findIndex(p=>p.clientId===botPilotId);if(i>=0)uncreated.splice(i,1);if(!existing.some(p=>p.clientId===botPilotId))existing.push(botPilot);report('bot_pilot_started',{clientId:botPilotId});}
  const canOverlap=((creatorKey==='kira'&&read(path.join(FOLDER,'kira-pilot.json'))?.done)||(creatorKey==='local'&&(read(path.join(FOLDER,'local-pilot.json'))?.done||!!preparationGate)))&&!botPilot;
  const results=await runQueue(canOverlap?[...existing,...uncreated]:existing,run,concurrency);
  if(canOverlap)uncreated.splice(0);
  if(botPilot){const s=read(path.join(FOLDER,'client-'+botPilotId+'.json'));if(!s?.completedAt||s.senderMode!=='bot'||Object.values(s.deliveries).some(d=>!d.done||d.result.senderId!=='8897025258'))throw Error('bot_pilot_failed');save(path.join(FOLDER,'bot-pilot.json'),{done:true,at:new Date().toISOString(),clientId:botPilotId,chatId:s.chatId,ownerId:s.ownerId,senderId:'8897025258',verification:s.steps.final_verify.result});report('bot_pilot_passed',{clientId:botPilotId,messages:botPilot.operations.length});}
  if(creatorKey==='kira'&&!read(path.join(FOLDER,'kira-pilot.json'))?.done){
   const settings=read(path.join(FOLDER,'settings.json')),pilot=settings.kiraPilotClientId?jobs.find(p=>p.clientId===settings.kiraPilotClientId):uncreated[0];if(!pilot)throw Error('kira_pilot_missing');
   if(!settings.kiraPilotClientId){settings.kiraPilotClientId=pilot.clientId;save(path.join(FOLDER,'settings.json'),settings);}
   const pilotIndex=uncreated.findIndex(p=>p.clientId===pilot.clientId);if(pilotIndex>=0)uncreated.splice(pilotIndex,1);
   report('kira_pilot_started',{clientId:pilot.clientId,operations:pilot.operations.length});
   const result=await run(pilot);
   await require('./observer-test.cjs').testObserver(pilot,result);
   save(path.join(FOLDER,'kira-pilot.json'),{done:true,at:new Date().toISOString(),clientId:pilot.clientId,chatId:result.chatId,ownerId:result.ownerId,verification:result.steps.final_verify.result});
   report('kira_pilot_passed',{clientId:pilot.clientId,chatId:result.chatId,messages:pilot.operations.length});
  }
  const notBefore=read(path.join(FOLDER,'settings.json'))?.creationNotBefore||0;
  if(creatorKey==='local'&&!read(path.join(FOLDER,'settings.json'))?.parallelAfterSendSmoke&&!read(path.join(FOLDER,'local-pilot.json'))?.done){
   const settings=read(path.join(FOLDER,'settings.json')),pilot=settings.localPilotClientId?jobs.find(p=>p.clientId===settings.localPilotClientId):uncreated[0];if(!pilot)throw Error('local_pilot_missing');
   if(!settings.localPilotClientId){settings.localPilotClientId=pilot.clientId;save(path.join(FOLDER,'settings.json'),settings);}
   const index=uncreated.findIndex(p=>p.clientId===pilot.clientId);if(index>=0)uncreated.splice(index,1);
   report('local_pilot_started',{clientId:pilot.clientId});const result=await run(pilot);
   if(!result.steps?.unicorn_join?.result?.historyVerified)throw Error('local_pilot_history_not_verified');
   save(path.join(FOLDER,'local-pilot.json'),{done:true,at:new Date().toISOString(),clientId:pilot.clientId,chatId:result.chatId,ownerId:result.ownerId,senderMode:result.senderMode,unicornJoin:result.steps.unicorn_join.result,verification:result.steps.final_verify.result});
   report('local_pilot_passed',{clientId:pilot.clientId,messages:pilot.operations.length});
  }
  if(uncreated.length&&notBefore>Date.now()){report('creation_paused',{until:new Date(notBefore).toISOString(),pending:uncreated.length});await sleep(notBefore-Date.now());}
  results.push(...await runQueue(uncreated,run,concurrency));
  const summary=await snapshot(plans);if(results.some(r=>!r.ok)||summary.groups.some(g=>!['complete','skipped'].includes(g.status)))throw Error('groups_incomplete');
  const states=plans.map(p=>p.clientId==='92'?read(path.join(FOLDER,'galina-preserved.json')):{...read(path.join(FOLDER,'client-'+p.clientId+'.json')),title:p.title});
  if(service){await service.disconnect();service=undefined;}await require('./delivery.cjs').publish(states,{client:creatorKey==='kira'?c:undefined});
  save(path.join(FOLDER,'completed.json'),{at:new Date().toISOString(),groups:114,restored:summary.groups.filter(g=>g.status==='complete').length,skipped:summary.groups.filter(g=>g.status==='skipped').length,fileDelivery:read(path.join(FOLDER,'file-delivery.json'))});
  report('batch_complete',{groups:114});
 }finally{if(timer)clearInterval(timer);await botAdmin?.disconnect();await service?.disconnect();await c.disconnect();release();}
}
module.exports={main,prepare,snapshot};
if(require.main===module)main({execute:process.argv.includes('--run')}).catch(e=>{report('batch_failed',{code:safeCode(e)});process.exitCode=1;});
