const fs=require('node:fs'),path=require('node:path');
const {FOLDER,ROOT,read,save,openCreator,openDb,Api,bi,sleep,report}=require('./live.cjs');
const {SCOPE,readiness,transferOnce}=require('./transfer-owner.cjs');
const {LOCAL_FOLDER,secret}=require('./local-extra-auth.cjs'),{hash}=require('./plan.cjs'),{canonicalText}=require('./telegram-text.cjs');
const receiptFile=path.join(FOLDER,'transfer-client-143.json'),statusFile=path.join(FOLDER,'transfer-client-143-status.json');
function isAlive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
async function execute(state,{client,scope=SCOPE,receipt=receiptFile,passwordProvider,reconcileOnly=false,authorizedScope}={}){
 const c=client||openCreator('local');let originalInvoke;try{
  if(!client)await c.connect();
  if(!reconcileOnly){originalInvoke=c.invoke;c.invoke=require('./read-rpc-gate.cjs').paceReadCalls({invoke:originalInvoke.bind(c),sleep,onWait:r=>report('ownership_read_wait',{clientId:scope.clientId,method:r.method,seconds:r.seconds})});}
  if(String((await c.getMe()).id)!==(reconcileOnly?scope.to:scope.from))throw Error('transfer_source_identity_mismatch');
  if(reconcileOnly&&(!read(receipt)?.intentAt||read(receipt)?.blocked))throw Error('transfer_reconciliation_not_pending');
  const invoke=async request=>{try{return await c.invoke(request);}catch(e){e.rpcMethod=request.className;throw e;}};
  const user=await c.getEntity('unicorn_service');if(String(user.id)!==scope.to||user.bot)throw Error('transfer_target_identity_mismatch');
  const input=reconcileOnly?await c.getInputEntity(bi(state.chatId)):{channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)};
  const target=await c.getInputEntity(user),channel=new Api.InputChannel({channelId:input.channelId,accessHash:input.accessHash}),peer=new Api.InputPeerChannel({channelId:input.channelId,accessHash:input.accessHash});
  const plan=read(path.join(FOLDER,'plans.json')).find(p=>p.clientId===scope.clientId);
  async function inspect(){
   const full=await invoke(new Api.channels.GetFullChannel({channel}));if(full.fullChat.hiddenPrehistory)throw Error('transfer_history_hidden');
   const admins=await invoke(new Api.channels.GetParticipants({channel,filter:new Api.ChannelParticipantsAdmins(),offset:0,limit:200,hash:bi(0)}));
   const owner=admins.participants.find(p=>p.className==='ChannelParticipantCreator');if(!owner)throw Error('transfer_owner_unresolved');
   const member=await invoke(new Api.channels.GetParticipant({channel,participant:target}));if(String(member.participant?.userId)!==scope.to||member.participant?.className==='ChannelParticipantBanned')throw Error('transfer_target_not_member');
   const messages=[];for await(const m of c.iterMessages(peer,{}))messages.push(m);
   const copies=require('./verify.cjs').restoredCopies(plan,messages,[scope.from,'8897025258']);
   if(copies.some((m,i)=>m.id!==state.deliveries[plan.operations[i].key].result.messageId||String(m.senderId)!==(state.deliveries[plan.operations[i].key].result.senderId||'8897025258')))throw Error('transfer_history_receipt_mismatch');
   const pins=[];for await(const m of c.iterMessages(peer,{filter:new Api.InputMessagesFilterPinned()}))pins.push(m.id);pins.sort((a,b)=>a-b);
   const expected=plan.operations.filter(o=>o.pin).map(o=>state.deliveries[o.key].result.messageId).sort((a,b)=>a-b);if(JSON.stringify(pins)!==JSON.stringify(expected))throw Error('transfer_pins_mismatch');
   // Inspect the exact saved link through its group peer. This works after an
   // ownership change and avoids the separately throttled invite preview API.
   const invite=await invoke(new Api.messages.GetExportedChatInvite({peer,link:state.invitation}));if(invite.invite?.link!==state.invitation||invite.invite?.revoked)throw Error('transfer_invite_invalid');
   if(authorizedScope){const support=await c.getEntity('veu_support');if(String(support.id)!=='8222949251')throw Error('handoff_support_identity_mismatch');const d=await invoke(new Api.channels.GetParticipant({channel,participant:await c.getInputEntity(support)}));if(!require('./support-admin-one.cjs').hasRights(d.participant))throw Error('handoff_support_rights_missing');}
   const db=await openDb();let row;try{row=(await db.query('SELECT id,'+(authorizedScope?'':'telegram_general_chat_id,')+'telegram_personal_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE id=$1',[scope.clientId])).rows[0];}finally{await db.end();}
   if(row?.secured_general_chat_id!==state.chatId||row?.secured_general_chat_invitation_link!==state.invitation)throw Error('transfer_sql_binding_mismatch');
   const entity=full.chats.find(x=>String(x.id)===state.channel.id);
   const digest=hash(JSON.stringify({history:copies.map(m=>[m.id,String(m.senderId),hash(canonicalText(m.message)),Number(m.media?.document?.size)||0]),pins,historyVisible:true,title:entity?.title,photoId:String(full.fullChat.chatPhoto?.id||''),sql:row}));
   return{ownerId:String(owner.userId),serviceMember:true,digest};
  }
  return await transferOnce(read(receipt)||{},{authorizedScope,now:Date.now,inspect,save:r=>save(receipt,r),prepare:async()=>{
   if(reconcileOnly)throw Error('read_only_transfer_reconciliation');
   const initial=await invoke(new Api.account.GetPassword());if(!initial.hasPassword)throw Error('transfer_2fa_not_enabled');
   report('transfer_local_password_prompt',{clientId:scope.clientId});let password=await (passwordProvider?passwordProvider():secret('Transfer group ownership: enter current owner 2FA password'));
   try{return await require('telegram/Password').computeCheck(await invoke(new Api.account.GetPassword()),password);}finally{password='';}
  },transfer:proof=>{if(reconcileOnly)throw Error('read_only_transfer_reconciliation');return invoke(new Api.channels.EditCreator({channel,userId:target,password:proof}));},verify:async baseline=>{const after=await inspect();if(after.ownerId!==scope.to||after.digest!==baseline)throw Error('transfer_postcondition_failed');}},scope);
 }finally{if(originalInvoke)c.invoke=originalInvoke;if(!client)await c.disconnect();}
}
async function main(){
 if(process.platform!=='win32')throw Error('local_transfer_windows_only');
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'ownership-transfer-local.lock'));
 try{
  const sessionFile=path.join(LOCAL_FOLDER,'gram.session'),fingerprint=hash(fs.readFileSync(sessionFile)),requestFile=path.join(FOLDER,'transfer-client-143-request.json');
  let request=read(requestFile);if(!request){request={...SCOPE,sessionSha256:fingerprint,requestedAt:new Date().toISOString()};save(requestFile,request);}
  if(request.sessionSha256!==fingerprint)throw Error('transfer_owner_session_changed');
  let lastReason;
  for(;;){
   const previous=read(receiptFile);if(previous?.done||previous?.blocked){report('transfer_terminal',{done:!!previous.done,blocked:!!previous.blocked,error:previous.error});return;}
   const state=read(path.join(FOLDER,'client-143.json')),identity=read(path.join(LOCAL_FOLDER,'identity.json')),lock=read(path.join(FOLDER,'batch.lock'));
   if(identity?.id!==SCOPE.from||hash(fs.readFileSync(sessionFile))!==fingerprint)throw Error('transfer_owner_session_changed');
   const gate=readiness({state,authorizedAt:identity.authorizedAt,runnerActive:!!lock&&isAlive(lock.pid)});
   if(!gate.ready){save(statusFile,{...SCOPE,status:'waiting',reason:gate.reason,notBefore:new Date(gate.notBefore).toISOString(),updatedAt:new Date().toISOString()});if(lastReason!==gate.reason){report('transfer_waiting',{reason:gate.reason,notBefore:new Date(gate.notBefore).toISOString()});lastReason=gate.reason;}await sleep(50000);continue;}
   let releaseBatch;try{releaseBatch=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));}catch(e){if(e.message==='restoration_already_running'){await sleep(50000);continue;}throw e;}
   try{const result=await execute(state);save(statusFile,{...SCOPE,status:result.done?'complete':'blocked',error:result.error,verifiedAt:result.verifiedAt,retryNotBefore:result.retryNotBefore});report('transfer_result',{clientId:SCOPE.clientId,done:!!result.done,blocked:!!result.blocked,error:result.error,retryNotBefore:result.retryNotBefore});return;}finally{releaseBatch();}
  }
 }finally{release();}
}
if(require.main===module)main().catch(e=>{const value=String(e.errorMessage||e.code||e.message),code=/^[a-zA-Z0-9_:-]{1,100}$/.test(value)?value:'transfer_failed';save(statusFile,{...SCOPE,status:'stopped',error:code,needsVerification:!!read(receiptFile)?.intentAt});report('transfer_stopped',{code});process.exitCode=1;});

module.exports={execute};
