const path=require('node:path'),fs=require('node:fs');
const {ROOT,REPO,FOLDER,read,save,openDb,report,sleep,bi}=require('./live.cjs');
const {openObserver}=require('./audit-additional-sources.cjs'),{sendOnce}=require('./smoke-send-once.cjs');
const OUT=path.join(REPO,'storage/group-restoration-additional'),TEXT='Тестовое сообщение, не обращайте внимание';
async function main(){
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock')),supportLock=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'support-join.lock'));
 const c=openObserver('support'),file=path.join(OUT,'write-smoke.json');let state=read(file);
 try{
  if(!state){const manifest=read(path.join(OUT,'manifest.json')),db=await openDb();let clients;try{clients=(await db.query('SELECT id,client_name,btrim(telegram_general_chat_id) chat_id FROM noco.clients WHERE id=ANY($1::bigint[]) AND coalesce(__nc_deleted,false)=false',[manifest.clientIds])).rows;}finally{await db.end();}
   if(clients.length!==30||new Set(clients.map(c=>c.chat_id)).size!==30)throw Error('smoke_target_count_mismatch');
   state={createdAt:new Date().toISOString(),text:TEXT,groups:clients.map(c=>({clientId:String(c.id),name:c.client_name,chatId:c.chat_id,sends:{}})),limits:{}};save(file,state);
  }
  if(state.text!==TEXT||state.groups.length!==30)throw Error('smoke_manifest_changed');
  const {createTelegramIntegration}=await import('file:///'+REPO.replace(/\\/g,'/')+'/src/integrations/telegram/integration.ts');const telegram=createTelegramIntegration({regularErrorChatId:'',summaryLogsChatId:'',logger(){},requestTimeoutMs:30000});
  await c.connect();const me=await c.getMe();if(String(me.id)!=='8222949251'||me.username?.toLowerCase()!=='veu_support')throw Error('smoke_support_identity_mismatch');
  const dialogs=[];for await(const d of c.iterDialogs({}))dialogs.push(d);
  for(const g of state.groups){const d=dialogs.find(d=>String(d.id)===g.chatId);if(d?.entity.deactivated||d?.entity.migratedTo)throw Error('smoke_deactivated_target');
   const peer=d?.inputEntity;for(const [sender,id]of [['bot','8897025258'],['support','8222949251']]){
    const receipt=g.sends[sender]||={};if(receipt.done||receipt.status==='rejected')continue;
    if(state.limits[sender]){receipt.status='waiting';receipt.error=state.limits[sender];save(file,state);continue;}
    const reconcile=async since=>{if(!peer)return null;const rows=(await c.getMessages(peer,{limit:40})).filter(m=>String(m.senderId)===id&&m.message===TEXT&&m.date*1000>=since-5000);if(rows.length!==1)return null;return{messageId:rows[0].id,verified:true};};
    await sendOnce(receipt,{now:Date.now,save:async()=>save(file,state),reconcile,send:async()=>{
     if(sender==='bot'){
      const r=await telegram.sendOne({chatId:g.chatId,text:TEXT});if(r.kind==='client-failure')return {};
      if(!r.response.ok){const e=r.response;return{rejected:true,code:e.error_code,error:e.description,retryAfter:e.parameters?.retry_after};}
      const m=r.response.result;if(String(m.chat.id)!==g.chatId||String(m.from?.id)!==id||m.text!==TEXT)throw Error('smoke_bot_identity_mismatch');return{messageId:m.message_id,verified:true};
     }
     if(!peer)return{rejected:true,error:'source_entity_unavailable'};
     try{const m=await c.sendMessage(peer,{message:TEXT,parseMode:false,linkPreview:false});if(String(m.senderId)!==id||m.message!==TEXT)throw Error('smoke_support_identity_mismatch');return{messageId:m.id,verified:true};}
     catch(e){if(e.errorMessage)return{rejected:true,error:e.errorMessage,retryAfter:e.seconds};return {};}
    }});
    if(receipt.status==='uncertain'){try{await sendOnce(receipt,{save:async()=>save(file,state),reconcile});}catch{}}
    if(receipt.error==='FLOOD'||receipt.error?.startsWith('FLOOD_WAIT_')||receipt.code===429){state.limits[sender]=receipt.error||'rate_limit';save(file,state);}
    report('group_write_smoke',{clientId:g.clientId,sender,status:receipt.status,error:receipt.error,code:receipt.code,messageId:receipt.messageId});await sleep(2000);
   }
  }
  state.finishedAt=new Date().toISOString();save(file,state);const rows=state.groups.flatMap(g=>Object.entries(g.sends).map(([sender,r])=>g.name+' (ID '+g.clientId+'), '+sender+': '+r.status+(r.error?' — '+r.error:'')+(r.messageId?' — message '+r.messageId:'')));
  fs.writeFileSync(path.join(OUT,'write-smoke-result.txt'),rows.join('\n'),'utf8');report('group_write_smoke_finished',{sent:state.groups.reduce((n,g)=>n+Object.values(g.sends).filter(r=>r.done).length,0),limits:state.limits});
 }finally{await c.disconnect();supportLock();release();}
}
if(require.main===module)main().catch(e=>{report('group_write_smoke_stopped',{error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'write_smoke_failed'});process.exitCode=1;});
