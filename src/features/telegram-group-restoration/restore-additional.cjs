const fs=require('node:fs'),path=require('node:path');
const {ROOT,REPO,FOLDER,read,save,openCreator,openDb,Api,bi,sleep,report,restore}=require('./live.cjs');
const {OUT,DATA,configure}=require('./prepare-additional-archive.cjs');
const {sendPreferred}=require('./additional-sender.cjs'),{hash}=require('./plan.cjs');
const IDS={unicorn:'8805256389',kira:'7586552066',local:'343610488',bot:'8897025258'},AUTHORS=Object.values(IDS);
const errorCode=e=>{const s=String(e.errorMessage||e.code||e.message);return /^[\w:-]{1,120}$/.test(s)?s:'additional_operation_failed';};
async function main(){
 const processLock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(OUT,'restore.lock'));
 try{
  while(!fs.existsSync(path.join(OUT,'plans.json'))){const stopped=read(path.join(OUT,'archive-status.json'));if(stopped?.status==='blocked')throw Error('archive_blocked_'+stopped.error);report('additional_waiting_for_archive');await sleep(50000);}
  configure();const plans=read(path.join(OUT,'plans.json'));if(plans.length!==27||new Set(plans.map(p=>p.clientId)).size!==27)throw Error('additional_plan_scope_mismatch');
  save(path.join(OUT,'settings.json'),{sender:'bot',senderPriority:['bot','unicorn','kira','local'],creatorPriority:['unicorn','kira','local']});
  let releaseBatch;for(;;){try{releaseBatch=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));break;}catch(e){if(e.message!=='restoration_already_running')throw e;await sleep(50000);}}
  const clients=new Map(),tails=new Map(),limits=read(path.join(OUT,'actor-limits.json'))||{};
  const stateFile=id=>path.join(OUT,'client-'+id+'.json');
  const blocked=key=>limits[key]?.blocked||limits[key]?.until>Date.now();
  function limit(key,e){const seconds=Number(e.retryAfter||e.seconds||String(e.errorMessage||e.error||'').match(/FLOOD_WAIT_(\d+)/)?.[1]||0);limits[key]={error:errorCode(e),method:e.rpcMethod,at:new Date().toISOString(),...(seconds?{until:Date.now()+(seconds+1)*1000}:{blocked:true})};save(path.join(OUT,'actor-limits.json'),limits);}
  function serialize(key,fn){const previous=tails.get(key)||Promise.resolve(),task=previous.catch(()=>{}).then(fn);tails.set(key,task.catch(()=>{}));return task;}
  async function actor(key){if(!clients.has(key)){const promise=(async()=>{const c=openCreator(key);await c.connect();if(String((await c.getMe()).id)!==IDS[key]){await c.disconnect();throw Error('additional_actor_identity_mismatch');}return c;})();clients.set(key,promise);}return await clients.get(key);}
  async function rpc(c,request,clientId){const key=c.restorationOwnerId+':'+(request.className==='channels.CreateChannel'?'create':'control');return await serialize(key,async()=>{
   if(blocked(key))throw Object.assign(Error('known_actor_limit'),{errorMessage:'FLOOD'});
   if(request.className==='channels.CreateChannel'){const db=await openDb();try{const row=(await db.query('SELECT client_status,secured_general_chat_id FROM noco.clients WHERE id=$1',[clientId])).rows[0];if(!row||row.client_status!=='studying'||row.secured_general_chat_id)throw Error('additional_creation_precondition_changed');}finally{await db.end();}}
   await sleep(Math.max(0,(limits[key]?.nextAt||0)-Date.now()));
   try{const value=await c.invoke(request);limits[key]={nextAt:Date.now()+(request.className==='channels.CreateChannel'?1000:6200)};save(path.join(OUT,'actor-limits.json'),limits);return value;}catch(e){e.rpcMethod=request.className;if(e.errorMessage==='FLOOD'||e.errorMessage?.startsWith('FLOOD_WAIT_'))limit(key,e);throw e;}
  });}
  async function verifyReader(c,plan,state,partial=false){
   const token=state.invitation.split('/').at(-1).replace(/^\+/,''),checked=await c.invoke(new Api.messages.CheckChatInvite({hash:token}));if(checked.className!=='ChatInviteAlready'||String(checked.chat?.id)!==state.channel.id)throw Error('additional_join_wrong_group');
   const peer=await c.getInputEntity(checked.chat),full=await c.invoke(new Api.channels.GetFullChannel({channel:peer}));if(full.fullChat.hiddenPrehistory)throw Error('additional_reader_history_hidden');
   const messages=[];for await(const m of c.iterMessages(peer,{}))messages.push(m);
   const expected=partial?{...plan,operations:plan.operations.filter(o=>state.deliveries?.[o.key]?.done)}:plan;
   const copies=require('./verify.cjs').restoredCopies(expected,messages,AUTHORS);for(let i=0;i<copies.length;i++)if(copies[i].id!==state.deliveries[expected.operations[i].key].result.messageId)throw Error('additional_reader_receipt_mismatch');
   return {joined:true,userId:c.restorationOwnerId,chatId:state.chatId,historyVerified:true,fullHistoryVerified:!partial};
  }
  async function join(key,plan,state,{partial=false}={}){const c=await actor(key),joinKey=IDS[key]+':join';
   if(state.ownerId===IDS[key]){
    const proof=partial?state.steps?.history:state.steps?.final_verify;
    if(!proof?.done||!(partial?proof.result?.visible:proof.result?.historyVisible))throw Error('additional_owner_history_unverified');
    if(Date.now()-(proof.intentAt||0)>60000){const full=await rpc(c,new Api.channels.GetFullChannel({channel:new Api.InputChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)})}));const entity=full.chats.find(e=>String(e.id)===state.channel.id);if(!entity?.creator||full.fullChat.hiddenPrehistory)throw Error('additional_owner_membership_unverified');}
    const result={joined:true,userId:IDS[key],chatId:state.chatId,historyVerified:true,fullHistoryVerified:!partial,via:'verified_owner'};save(path.join(OUT,'join-'+key+'-'+plan.clientId+'.json'),{done:true,...result,at:new Date().toISOString()});return result;
   }
   if(blocked(joinKey))throw Object.assign(Error('known_join_limit'),{errorMessage:'FLOOD'});
   return await serialize(joinKey,async()=>{
    const file=path.join(OUT,'join-'+key+'-'+plan.clientId+'.json'),r=read(file)||{},token=state.invitation.split('/').at(-1).replace(/^\+/,''),checked=await c.invoke(new Api.messages.CheckChatInvite({hash:token}));
    if(checked.className!=='ChatInviteAlready'){
     if(r.intentAt)throw Error('additional_join_outcome_unresolved');await sleep(Math.max(0,(limits[joinKey]?.nextAt||0)-Date.now()));r.intentAt=Date.now();save(file,r);
     try{await c.invoke(new Api.messages.ImportChatInvite({hash:token}));}
     catch(e){if(e.errorMessage){delete r.intentAt;save(file,r);if(e.errorMessage==='FLOOD'||e.errorMessage.startsWith('FLOOD_WAIT_'))limit(joinKey,e);}throw e;}
     finally{if(!blocked(joinKey)){limits[joinKey]={nextAt:Date.now()+60000};save(path.join(OUT,'actor-limits.json'),limits);}}
    }
    const result=await verifyReader(c,plan,state,partial);save(file,{done:true,...result,at:new Date().toISOString()});return result;
   });
  }
  const {createTelegramIntegration}=await import('file:///'+REPO.replace(/\\/g,'/')+'/src/integrations/telegram/integration.ts');
  const telegram=createTelegramIntegration({regularErrorChatId:'',summaryLogsChatId:'',logger(){},requestTimeoutMs:120000});
  async function send(op,state,creator,peer){const plan=plans.find(p=>p.clientId===state.clientId);return await sendPreferred(op,{
   available:async key=>!blocked(IDS[key]+':send')&&(key==='bot'||state.ownerId===IDS[key]||!blocked(IDS[key]+':join')),
   limit:async(key,result)=>limit(IDS[key]+':send',{...result,message:result.error||'send_limit'}),
   send:async key=>{
    if(key==='bot'){
     const input={chatId:state.chatId,text:op.text};if(op.file){const data=fs.readFileSync(op.file.path);if(data.length!==op.file.bytes||hash(data)!==op.file.sha256)throw Error('attachment_hash_changed');input.attachment={file:new Blob([data]),filename:op.file.name};}
     const r=await telegram.sendOne(input);if(r.kind==='client-failure'){
      try{return require('./owner-send.cjs').findReceipt(op,await creator.getMessages(peer,{limit:100}),AUTHORS);}catch{return {uncertain:true};}
     }
     if(!r.response.ok){const e=r.response;return{...(e.error_code===429?{limited:true}:{rejected:true}),error:'bot_'+e.error_code,retryAfter:e.parameters?.retry_after};}
     const m=r.response.result;if(String(m.chat.id)!==state.chatId||String(m.from?.id)!==IDS.bot)throw Error('additional_bot_response_mismatch');return {messageId:m.message_id,senderId:IDS.bot};
    }
    let c;try{c=await actor(key);if(state.ownerId!==IDS[key])await join(key,plan,state,{partial:true});}
    catch(e){if(e.errorMessage==='FLOOD'||e.errorMessage?.startsWith('FLOOD_WAIT_'))return{rejected:true,error:e.errorMessage};throw e;}
    return await serialize(IDS[key]+':send',async()=>{
     if(blocked(IDS[key]+':send'))return{limited:true,error:'known_sender_limit'};await sleep(Math.max(0,(limits[IDS[key]+':send']?.nextAt||0)-Date.now()));
     try{const current=state.ownerId===IDS[key]?peer:await c.getInputEntity((await c.invoke(new Api.messages.CheckChatInvite({hash:state.invitation.split('/').at(-1).replace(/^\+/,'' )}))).chat);let m;
      if(op.file){const data=fs.readFileSync(op.file.path);if(data.length!==op.file.bytes||hash(data)!==op.file.sha256)throw Error('attachment_hash_changed');const {CustomFile}=require('telegram/client/uploads');m=await c.sendFile(current,{file:new CustomFile(op.file.name,data.length,'',data),caption:op.text,forceDocument:true,parseMode:false,workers:1});}
      else m=await c.sendMessage(current,{message:op.text,parseMode:false,linkPreview:false});
      if(String(m.senderId)!==IDS[key]||!require('./telegram-text.cjs').sameTelegramText(op.text,m.message||''))throw Error('additional_sender_response_mismatch');limits[IDS[key]+':send']={nextAt:Date.now()+500};return{messageId:m.id,senderId:IDS[key]};
     }catch(e){if(e.errorMessage==='FLOOD'||e.errorMessage?.startsWith('FLOOD_WAIT_'))return{limited:true,error:e.errorMessage,retryAfter:e.seconds};if(e.errorMessage)return{rejected:true,error:e.errorMessage};return{uncertain:true};}
    });
   }
  });}
  let phase='running';
  function snapshot(status=phase){phase=status;const groups=plans.map(p=>{const s=read(stateFile(p.clientId));return{clientId:p.clientId,sourceChatId:p.sourceChatId,chatId:s?.chatId,status:s?.completedAt?'complete':s?.skipped?'skipped':s?.channel?'in_progress':'pending',messages:Object.values(s?.deliveries||{}).filter(d=>d.done).length,total:p.operations.length,pins:p.pins,historyVisible:!!s?.steps?.history?.done,error:s?.lastError,ownerId:s?.ownerId};});save(path.join(OUT,'report.json'),{at:new Date().toISOString(),status,groups});return groups;}
  async function run(plan){let state=read(stateFile(plan.clientId));if(state?.completedAt)return state;
   const db=await openDb();try{const row=(await db.query('SELECT client_status,secured_general_chat_id FROM noco.clients WHERE id=$1',[plan.clientId])).rows[0];if(row?.secured_general_chat_id&&row.secured_general_chat_id!==state?.chatId)throw Error('additional_existing_secured_group');if(row?.client_status!=='studying'&&!state?.channel){save(stateFile(plan.clientId),{clientId:plan.clientId,skipped:true,reason:'status_changed'});return;}}finally{await db.end();}
   for(const key of state?.channel?[Object.keys(IDS).find(k=>IDS[k]===state.ownerId)]:['unicorn','kira','local']){
    if(!state?.channel&&blocked(IDS[key]+':create'))continue;
    try{const c=await actor(key),result=await restore(plan,c,telegram,null,{folder:OUT,invokeRpc:rpc,allowedAuthors:AUTHORS,sendOperation:send,joinUnicorn:(p,s,o)=>join('unicorn',p,s,o),verifyInvitation:(s,owner,peer)=>require('./owned-invite.cjs').verifyOwnedInvite(s,{ownerId:owner.restorationOwnerId,getExported:link=>rpc(owner,new Api.messages.GetExportedChatInvite({peer,link}))})});snapshot();return result;}
    catch(e){state=read(stateFile(plan.clientId));if(state){state.lastError=errorCode(e);if(!state.channel&&(e.errorMessage==='FLOOD'||e.errorMessage?.startsWith('FLOOD_WAIT_'))){state.creationReconciledAt=new Date().toISOString();save(stateFile(plan.clientId),state);continue;}save(stateFile(plan.clientId),state);}snapshot();throw e;}
   }
   throw Error('all_creators_unavailable');
  }
  let timer;
  try{
   timer=setInterval(()=>{snapshot();},30000);snapshot();
   const jobs=require('./runner.cjs').ordered(plans),pilot=read(path.join(OUT,'pilot.json'));
   if(!pilot?.done){const plan=jobs[0],state=await run(plan);if(!state?.completedAt)throw Error('additional_pilot_incomplete');let verified=false;
    for(const key of ['kira','local','unicorn'].filter(k=>IDS[k]!==state.ownerId)){try{await join(key,plan,state);verified=true;save(path.join(OUT,'pilot.json'),{done:true,clientId:plan.clientId,chatId:state.chatId,newReader:IDS[key],at:new Date().toISOString()});break;}catch(e){if(errorCode(e)==='additional_join_outcome_unresolved')throw e;report('additional_pilot_reader_unavailable',{account:key,error:errorCode(e)});}}
    if(!verified)throw Error('additional_new_reader_not_verified');report('additional_pilot_complete',{clientId:plan.clientId});
   }
   let groups;
   for(;;){
    snapshot('running');
    await require('./runner.cjs').runQueue(jobs.filter(p=>!read(stateFile(p.clientId))?.completedAt&&!read(stateFile(p.clientId))?.skipped),run,8);
    groups=snapshot();const pending=groups.filter(g=>g.status!=='complete'&&g.status!=='skipped');if(!pending.length)break;
    const retryable=pending.every(g=>g.error==='FLOOD'||g.error?.startsWith('FLOOD_WAIT_')||g.error==='send_rejected_all_senders_unavailable');
    const timed=Object.values(limits).filter(v=>Number.isFinite(v.until));
    if(!retryable||!timed.length||Object.values(limits).some(v=>v.blocked)){snapshot('needs_review');throw Error('additional_groups_incomplete');}
    const future=timed.map(v=>v.until).filter(t=>t>Date.now()),until=future.length?Math.min(...future):Date.now()+2000;
    snapshot('waiting_limits');report('additional_resume_after_explicit_limit',{pending:pending.length,notBefore:new Date(until).toISOString()});while(Date.now()<until)await sleep(Math.min(50000,until-Date.now()));
   }
   const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const html='<!doctype html><meta charset="utf-8"><h1>Приглашения: дополнительные восстановленные группы</h1><p>Общие группы по стекам пока не созданы.</p><ul>'+plans.map(p=>{const s=read(stateFile(p.clientId));return s.completedAt?'<li><a href="'+esc(s.invitation)+'">'+esc(p.title)+'</a></li>':'';}).join('')+'</ul>';
   fs.writeFileSync(path.join(OUT,'invitations.html'),html,'utf8');save(path.join(OUT,'completed.json'),{at:new Date().toISOString(),groups:groups.length,restored:groups.filter(g=>g.status==='complete').length});snapshot('complete');report('additional_restoration_complete',{groups:groups.length});
  }finally{clearInterval(timer);for(const pending of clients.values()){try{await (await pending).disconnect();}catch{}}releaseBatch();}
 }finally{processLock();}
}
if(require.main===module)main().catch(e=>{save(path.join(OUT,'restore-status.json'),{at:new Date().toISOString(),status:'blocked',error:errorCode(e)});report('additional_restoration_stopped',{error:errorCode(e)});process.exitCode=1;});
