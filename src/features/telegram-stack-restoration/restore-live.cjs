const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,OUT,read,save,file,sleep,Api,bi,ACCOUNTS,report}=require('./context.cjs');
const {hash}=require('../telegram-group-restoration/plan.cjs'),{runJob}=require('../telegram-group-restoration/runner.cjs');
const {restoredCopies}=require('../telegram-group-restoration/verify.cjs'),{sameTelegramText}=require('../telegram-group-restoration/telegram-text.cjs');
const {verifyOwnedInvite}=require('../telegram-group-restoration/owned-invite.cjs');
const {definiteRejection}=require('./rejection.cjs');
const createGate=require('../telegram-group-restoration/create-gate.cjs').createGate({load:()=>Math.max(read(file('create-rate'))?.nextAt||0,read(path.join(FOLDER,'create-gate.json'))?.nextAt||0),save:nextAt=>save(file('create-rate'),{nextAt}),sleep});
async function restoreStack(plan,owner,rpc,sendGate,observerCheck){
 const stateFile=file('group-'+plan.stackKey),state=read(stateFile)||{version:1,stackKey:plan.stackKey,sourceChatId:plan.sourceChatId,ownerId:ACCOUNTS.owner};
 if(state.stackKey!==plan.stackKey||state.sourceChatId!==plan.sourceChatId||state.ownerId!==ACCOUNTS.owner)throw Error('stack_scope_changed');
 if(state.completedAt){if(state.planHash!==plan.planHash)throw Error('stack_plan_changed');return state;}
 const persist=async()=>save(stateFile,state),channel=()=>new Api.InputChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)}),peer=()=>new Api.InputPeerChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)});
 async function full(){const f=await rpc(owner,new Api.channels.GetFullChannel({channel:channel()}));const entity=f.chats.find(e=>String(e.id)===state.channel.id);if(!entity?.creator||entity.left||entity.username||!entity.megagroup)throw Error('stack_target_not_private_owned_supergroup');return{...f,entity};}
 async function verify(){const f=await full();if(f.fullChat.hiddenPrehistory||f.entity.defaultBannedRights?.sendMessages||f.entity.defaultBannedRights?.sendPlain)throw Error('stack_history_or_member_writing_forbidden');
  const rows=[];for await(const m of owner.iterMessages(peer(),{}))rows.push(m);const copies=restoredCopies(plan,rows,[ACCOUNTS.owner]);
  if(copies.some((m,i)=>m.id!==state.deliveries[plan.operations[i].key].result.messageId))throw Error('stack_delivery_receipt_mismatch');
  const pins=[];for await(const m of owner.iterMessages(peer(),{filter:new Api.InputMessagesFilterPinned()}))pins.push(m.id);
  const expected=plan.operations.filter(o=>o.pin).map(o=>state.deliveries[o.key].result.messageId).sort((a,b)=>a-b);if(JSON.stringify(pins.sort((a,b)=>a-b))!==JSON.stringify(expected))throw Error('stack_pins_mismatch');
  if(plan.avatar&&String(f.fullChat.chatPhoto?.id)!==state.avatar?.photoId)throw Error('stack_avatar_mismatch');
  return{messages:copies.length,files:plan.operations.filter(o=>o.file).length,pins:pins.length,historyVisible:true};
 }
 async function stage(name,uncertain){
  if(['bot','bot_admin','early_invite','unicorn_join_early','sql','bot_admin_restore'].includes(name))return{notRequired:true};
  if(name==='preflight'){const {planHash,avatar,...body}=plan;if(hash(JSON.stringify(body))!==planHash)throw Error('stack_plan_hash_invalid');for(const op of plan.operations){if(hash(op.text)!==op.hash)throw Error('stack_message_hash_invalid');if(op.file){const b=fs.readFileSync(op.file.path);if(b.length!==op.file.bytes||hash(b)!==op.file.sha256)throw Error('stack_attachment_corrupt');}}return{verified:true};}
  if(name==='create'){
   if(!state.channel){let entity;const dialogs=await owner.getDialogs({limit:500});const candidates=dialogs.filter(d=>d.title===plan.title&&d.entity.creator&&d.entity.megagroup);
    if(uncertain){const found=candidates.filter(d=>d.entity.date*1000>=state.steps.create.intentAt-10000);if(found.length!==1)throw Error('stack_creation_outcome_unresolved');entity=found[0].entity;}
    else{if(candidates.length)throw Error('stack_possible_existing_replacement');const result=await createGate(()=>rpc(owner,new Api.channels.CreateChannel({title:plan.title,about:'',megagroup:true})));entity=result.chats.find(c=>c.creator&&c.megagroup);if(!entity)throw Error('stack_creation_unverified');}
    state.channel={id:String(entity.id),accessHash:String(entity.accessHash),createdAt:Date.now()};state.chatId=String(-1000000000000n-BigInt(entity.id));await persist();report('stack_created',{stack:plan.stackKey,chatId:state.chatId});
   }await full();return{chatId:state.chatId};
  }
  if(name==='history'){let f=await full();if(f.fullChat.hiddenPrehistory)await rpc(owner,new Api.channels.TogglePreHistoryHidden({channel:channel(),enabled:false}));f=await full();if(f.fullChat.hiddenPrehistory)throw Error('stack_history_not_visible');if(f.entity.defaultBannedRights?.sendMessages||f.entity.defaultBannedRights?.sendPlain)throw Error('stack_member_writing_forbidden');return{visible:true};}
  if(name==='avatar'){
   if(!plan.avatar)return{none:true};const b=fs.readFileSync(plan.avatar.path);if(b.length!==plan.avatar.bytes||hash(b)!==plan.avatar.sha256)throw Error('stack_avatar_corrupt');
   await sleep(Math.max(0,state.channel.createdAt+15000-Date.now()));const f=await full(),oldId=String(f.fullChat.chatPhoto?.id||'');
   if(state.avatar?.photoId===oldId)return state.avatar;
   if(state.avatarIntent){if(!oldId||oldId===state.avatarIntent.oldId)throw Error('stack_avatar_outcome_unresolved');state.avatar={photoId:oldId,sha256:plan.avatar.sha256,reconciled:true};await persist();return state.avatar;}
   state.avatarIntent={oldId};await persist();const {CustomFile}=require('telegram/client/uploads');const uploaded=await sendGate(()=>owner.uploadFile({file:new CustomFile('avatar.jpg',b.length,'',b),workers:1}));await rpc(owner,new Api.channels.EditPhoto({channel:channel(),photo:new Api.InputChatUploadedPhoto({file:uploaded})}));const after=await full();state.avatar={photoId:String(after.fullChat.chatPhoto.id),sha256:plan.avatar.sha256};await persist();return state.avatar;
  }
  if(name==='mute'){await rpc(owner,new Api.account.UpdateNotifySettings({peer:new Api.InputNotifyPeer({peer:peer()}),settings:new Api.InputPeerNotifySettings({muteUntil:2147483647,silent:true})}));return{muted:true};}
  if(name==='verify'||name==='final_verify')return verify();
  if(name==='invite'){
   if(!state.invitation){if(uncertain){const r=await rpc(owner,new Api.messages.GetExportedChatInvites({peer:peer(),adminId:new Api.InputUserSelf(),limit:100}));const xs=r.invites.filter(i=>!i.revoked&&i.title==='restoration v2 '+plan.stackKey);if(xs.length!==1)throw Error('stack_invite_outcome_unresolved');state.invitation=xs[0].link;}
    else{const r=await rpc(owner,new Api.messages.ExportChatInvite({peer:peer(),title:'restoration v2 '+plan.stackKey,requestNeeded:false}));if(!r.link||r.revoked)throw Error('stack_invite_invalid');state.invitation=r.link;}await persist();}
   return verifyOwnedInvite({...state,clientId:plan.stackKey},{ownerId:ACCOUNTS.owner,getExported:link=>rpc(owner,new Api.messages.GetExportedChatInvite({peer:peer(),link}))});
  }
  if(name==='unicorn_join')return observerCheck(plan,state);
  throw Error('stack_unknown_stage');
 }
 try{
  await runJob(plan,state,{save:persist,sleep,stage,
   reconcile:async op=>require('../telegram-group-restoration/owner-send.cjs').findReceipt(op,await owner.getMessages(peer(),{limit:100}),[ACCOUNTS.owner]),
   pin:async(op,result)=>{await rpc(owner,new Api.messages.UpdatePinnedMessage({peer:peer(),id:result.messageId,silent:true}));return{messageId:result.messageId};},
   send:async op=>{try{return await sendGate(async()=>{
    const adapter={restorationOwnerId:ACCOUNTS.owner};for(const method of ['sendMessage','sendFile'])adapter[method]=async(...args)=>{try{return await owner[method](...args);}catch(e){if(definiteRejection(e)){delete state.deliveries[op.key].intentAt;await persist();}if(e.errorMessage==='FLOOD')throw Object.assign(Error('bare_flood_stops_account'),{code:'FLOOD'});throw e;}};
    const result=await require('../telegram-group-restoration/owner-send.cjs').sendOwner(op,{client:adapter,peer:peer(),readFile:fs.readFileSync});
    if(result.retryAfter!==undefined)throw Object.assign(Error('explicit_send_flood'),{errorMessage:'FLOOD_WAIT_'+Math.max(0,result.retryAfter-1),seconds:Math.max(0,result.retryAfter-1)});
    return result;
   });}catch(e){if(e.code==='ACCOUNT_FLOOD_STOPPED'){delete state.deliveries[op.key].intentAt;await persist();}throw e;}}
  });
  delete state.lastError;await persist();report('stack_complete',{stack:plan.stackKey,chatId:state.chatId,messages:plan.operations.length});return state;
 }catch(e){state.lastError=e.errorMessage||e.code||e.message;state.failedAt=new Date().toISOString();await persist();throw e;}
}
module.exports={restoreStack};
