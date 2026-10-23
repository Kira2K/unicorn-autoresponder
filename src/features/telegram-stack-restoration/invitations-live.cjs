const path=require('node:path');
const {ROOT,REPO,FOLDER,OUT,read,save,file,rows,Api,bi,ACCOUNTS,report,sleep}=require('./context.cjs');
const {audience,target,validateRecipient,deadline,STACKS}=require('./policy.cjs');
const {deliverOnce}=require('./delivery.cjs');
const {definiteRejection}=require('./rejection.cjs');
function restoredBinding(clientId,chatId){
 const folders=[FOLDER,path.join(REPO,'storage/group-restoration-additional'),path.join(REPO,'storage/student-invites-20261018/restoration'),path.join(REPO,'storage/group-restoration-komlev-20261023')];
 for(const folder of folders){const s=read(path.join(folder,clientId==='92'&&folder===FOLDER?'galina-preserved.json':'client-'+clientId+'.json'));if(s?.chatId===chatId&&!s.skipped&&(s.completedAt||s.complete)&&s.steps?.final_verify?.done!==false)return true;}
 return false;
}
function username(value){const s=String(value||'').trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i,'').replace(/^@/,'');return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(s)?s:null;}
async function sendInvitations({owner,observer,ownerGate,observerGate}){
 const actors={owner,observer},gates={owner:ownerGate,observer:observerGate},ids={owner:ACCOUNTS.owner,observer:ACCOUNTS.observer};
 const clients=await rows(),selected=audience(clients),byId=new Map(clients.map(r=>[String(r.id),r]));
 const duplicates=require('./destinations.cjs').ambiguousDestinations(clients);
 const loaded=new Map(),availableCache=new Map();
 async function peer(account,chatId){
  const client=actors[account],gate=gates[account];if(!loaded.has(account))loaded.set(account,await gate(()=>client.getDialogs({limit:2000})));
  const dialogs=loaded.get(account),dialog=dialogs.find(d=>String(d.id)===chatId);
  if(!dialog){if(dialogs.length>=2000)throw Error('destination_inventory_incomplete');throw Object.assign(Error('not_a_current_member'),{errorMessage:'NOT_IN_DESTINATION_DIALOGS'});}
  const input=dialog.inputEntity;if(!['InputPeerChannel','InputPeerChat'].includes(input.className))throw Object.assign(Error('not_group_destination'),{errorMessage:'NOT_GROUP_DESTINATION'});return input;
 }
 async function inspect(account,row,destination){
  const client=actors[account],gate=gates[account],input=await peer(account,destination.chatId);let entity,full;
  if(input.className==='InputPeerChannel'){
   const r=await gate(()=>client.invoke(new Api.channels.GetFullChannel({channel:input})));entity=r.chats.find(e=>String(-1000000000000n-BigInt(e.id))===destination.chatId);full=r.fullChat;
  }else{const r=await gate(()=>client.invoke(new Api.messages.GetFullChat({chatId:input.chatId})));entity=r.chats.find(e=>String(-BigInt(e.id))===destination.chatId);full=r.fullChat;}
  if(!entity||entity.left||entity.deactivated||entity.migratedTo||entity.broadcast||entity.restrictionReason?.some(r=>r.reason==='terms'&&r.platform==='all'))throw Object.assign(Error('unavailable_group'),{errorMessage:'DESTINATION_UNAVAILABLE'});
  if(!entity.creator&&!entity.adminRights&&(entity.bannedRights?.sendMessages||entity.bannedRights?.sendPlain||entity.defaultBannedRights?.sendMessages||entity.defaultBannedRights?.sendPlain))throw Object.assign(Error('no_write_permission'),{errorMessage:'CHAT_WRITE_FORBIDDEN'});
  const journalConfirmed=destination.secured&&restoredBinding(String(row.id),destination.chatId);
  if(!journalConfirmed){
   const tag=username(row.telegram_personal_chat_id);if(!tag)throw Object.assign(Error('student_identity_unknown'),{errorMessage:'STUDENT_IDENTITY_UNKNOWN'});
   const user=await gate(()=>client.getEntity(tag));if(user.bot||user.deleted)throw Object.assign(Error('invalid_student'),{errorMessage:'STUDENT_IDENTITY_INVALID'});
   let present;
   if(input.className==='InputPeerChat')present=full.participants?.participants?.some(p=>String(p.userId)===String(user.id));
   else{try{const p=(await gate(()=>client.invoke(new Api.channels.GetParticipant({channel:input,participant:awaitInputUser(client,user)})))).participant;present=['ChannelParticipant','ChannelParticipantSelf','ChannelParticipantAdmin','ChannelParticipantCreator'].includes(p.className)||p.className==='ChannelParticipantBanned'&&!p.left;}catch(e){if(e.errorMessage==='USER_NOT_PARTICIPANT')present=false;else throw e;}}
   if(!present)throw Object.assign(Error('student_not_in_individual_group'),{errorMessage:'STUDENT_NOT_IN_DESTINATION'});
  }
  return{input,journalConfirmed};
 }
 function awaitInputUser(client,user){return new Api.InputPeerUser({userId:user.id,accessHash:user.accessHash});}
 async function probe(account,row,expected,input){
  const probeFile=file('probe-'+row.id+'-'+account),p=read(probeFile)||{},text='Тестовое сообщение, не обращайте внимание',client=actors[account],gate=gates[account];
  if(p.chatId&&p.chatId!==expected.chatId)throw Error('probe_destination_changed');
  p.chatId=expected.chatId;
  if(p.deleted)return;
  if(!p.intentAt){const valid=validateRecipient((await rows(row.id))[0],expected);if(!valid.ok)throw Object.assign(Error(valid.reason),{errorMessage:'RECIPIENT_SCOPE_CHANGED'});const last=await gate(()=>client.getMessages(input,{limit:1}));p.baselineId=last[0]?.id||0;p.intentAt=Date.now();save(probeFile,p);
   try{const m=await gate(async()=>{if(!validateRecipient((await rows(row.id))[0],expected).ok)throw Object.assign(Error('scope_changed'),{errorMessage:'RECIPIENT_SCOPE_CHANGED'});return client.sendMessage(input,{message:text,parseMode:false,linkPreview:false});});if(String(m.senderId)!==ids[account]||m.message!==text)throw Error('probe_sender_mismatch');p.messageId=m.id;p.verified=true;save(probeFile,p);}catch(e){p.error=e.errorMessage||e.code||'uncertain';if(definiteRejection(e))delete p.intentAt;save(probeFile,p);throw e;}
  }
  if(!p.messageId){const ms=await gate(()=>client.getMessages(input,{limit:100}));const found=ms.filter(m=>String(m.senderId)===ids[account]&&m.message===text&&m.id>p.baselineId);if(found.length!==1)throw Error('probe_outcome_unresolved');p.messageId=found[0].id;p.verified=true;save(probeFile,p);}
  const m=(await gate(()=>client.getMessages(input,{ids:[p.messageId]})))[0];
  if(m?.className==='Message'){if(String(m.senderId)!==ids[account]||m.message!==text)throw Error('probe_cleanup_mismatch');p.deleteIntentAt=Date.now();save(probeFile,p);await gate(()=>client.deleteMessages(input,[p.messageId],{revoke:true}));}
  else if(!p.deleteIntentAt)throw Error('probe_missing_before_cleanup');
  if((await gate(()=>client.getMessages(input,{ids:[p.messageId]})))[0]?.className==='Message')throw Error('probe_cleanup_pending');p.deleted=true;save(probeFile,p);
 }
 const results=[];
 const snapshot=()=>save(file('recipient-report'),{at:new Date().toISOString(),results,sent:results.filter(r=>r.status==='sent').length,excluded:results.filter(r=>r.status==='excluded').length,deferred:results.filter(r=>!['sent','excluded','skipped'].includes(r.status)).length});
 for(const chosen of selected){
  const row=byId.get(chosen.clientId),result={...chosen,clientName:row.client_name,clientStatus:chosen.status};
  if(!chosen.eligible){results.push({...result,status:'excluded'});snapshot();continue;}
  const group=read(file('group-'+chosen.stackKey)),destination=target(row);
  if(!group?.completedAt||!group.steps?.unicorn_join?.done){results.push({...result,status:'deferred',reason:'stack_group_not_verified'});snapshot();continue;}
  if(!destination||duplicates.has(destination.chatId)){results.push({...result,status:'deferred',reason:destination?'duplicate_individual_destination':'no_individual_destination'});snapshot();continue;}
  const expected={clientId:chosen.clientId,stackKey:chosen.stackKey,chatId:destination.chatId},receiptFile=file('recipient-'+chosen.clientId+'-'+chosen.stackKey),receipt=read(receiptFile)||{};
  if(receipt.chatId&&receipt.chatId!==destination.chatId){results.push({...result,status:'deferred',reason:'recorded_destination_changed'});snapshot();continue;}
  Object.assign(receipt,{chatId:destination.chatId,stackKey:chosen.stackKey,clientId:chosen.clientId});
  const title=read(file('plan-'+chosen.stackKey)).title,text=`Восстановили общий чат «${title}» с историей за последние полгода. Присоединяйся по ссылке: ${group.invitation}`;
  const available={};
  try{
   await deliverOnce(receipt,{
    now:Date.now,save:r=>save(receiptFile,r),validate:async()=>validateRecipient((await rows(chosen.clientId))[0],expected),
    available:async account=>{try{if(read(file('account-'+account))?.stopAccount)return false;const current=(await rows(chosen.clientId))[0];if(!validateRecipient(current,expected).ok)return false;const key=account+':'+chosen.clientId+':'+destination.chatId;let checked=availableCache.get(key);if(!checked){checked=await inspect(account,current,destination);availableCache.set(key,checked);}if(!checked.journalConfirmed)await probe(account,current,expected,checked.input);available[account]=checked.input;return true;}catch(e){(receipt.unavailable||={})[account]=deadline(e).error;save(receiptFile,receipt);if(!definiteRejection(e))throw e;return false;}},
    send:async account=>{const client=actors[account],gate=gates[account],input=available[account];
     try{const latest=await gate(()=>client.getMessages(input,{limit:1}));receipt.intent.baselineId=latest[0]?.id||0;save(receiptFile,receipt);
      const m=await gate(async()=>{if(!validateRecipient((await rows(chosen.clientId))[0],expected).ok)throw Object.assign(Error('recipient_changed'),{errorMessage:'RECIPIENT_SCOPE_CHANGED'});return client.sendMessage(input,{message:text,parseMode:false,linkPreview:false});});
      if(String(m.senderId)!==ids[account]||m.message!==text)throw Error('invitation_sender_or_text_mismatch');return{messageId:m.id,senderId:ids[account]};
     }catch(e){if(definiteRejection(e))return{rejected:true,error:e.errorMessage||e.code};throw e;}
    },
    reconcile:async intent=>{const client=actors[intent.account],gate=gates[intent.account],input=await peer(intent.account,destination.chatId);const ms=await gate(()=>client.getMessages(input,{limit:100}));const found=ms.filter(m=>String(m.senderId)===ids[intent.account]&&m.message===text&&m.id>(intent.baselineId||0)&&m.date*1000>=intent.at-5000);return found.length===1?{messageId:found[0].id,senderId:ids[intent.account],account:intent.account,reconciled:true}:null;}
   });
   results.push({...result,chatId:destination.chatId,status:receipt.status,reason:receipt.reason,account:receipt.result?.account,messageId:receipt.result?.messageId,unavailable:receipt.unavailable,rejections:receipt.rejections});
  }catch(e){results.push({...result,chatId:destination.chatId,status:receipt.intent?'uncertain':'deferred',reason:deadline(e).error});}
  snapshot();report('stack_invitation_result',{clientId:chosen.clientId,stack:chosen.stackKey,status:results.at(-1).status});
 }
 snapshot();report('stack_invitations_finished',{sent:results.filter(r=>r.status==='sent').length,excluded:results.filter(r=>r.status==='excluded').length,deferred:results.filter(r=>!['sent','excluded','skipped'].includes(r.status)).length});return results;
}
module.exports={sendInvitations,restoredBinding,username};
