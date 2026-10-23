const fs=require('node:fs'),path=require('node:path');
const {hash}=require('./plan.cjs'),{runJob}=require('./runner.cjs');
const {ownerIntervalMs}=require('./limits.cjs');
const ROOT='C:/Users/kiras/TelegramArchives/VEU';
const REPO=path.resolve(__dirname,'../../..');
require('dotenv').config({path:path.join(REPO,'.env'),quiet:true});
const FOLDER=path.join(REPO,'storage/group-restoration-v2');
const BOT='8897025258',OWNER='8805256389';
const {TelegramClient,Api}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger'),bi=require('big-integer');
function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
const save=require('./atomic-json.cjs').saveAtomic;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report=(event,details={})=>console.log(JSON.stringify({at:new Date().toISOString(),event,...details}));
function creatorIdentity(key='unicorn'){if(key==='local'){if(process.platform!=='win32')throw Error('local_windows_account_only');const folder=require('./local-extra-auth.cjs').LOCAL_FOLDER;return require('./account.cjs').account(key,read(path.join(folder,'identity.json')));}return require('./account.cjs').account(key);}
function openCreator(key='unicorn'){const identity=creatorIdentity(key);let sessionFile,api;if(key==='kira'||key==='local'){sessionFile=key==='kira'?path.join(REPO,'.telegram-session'):path.join(require('./local-extra-auth.cjs').LOCAL_FOLDER,'gram.session');api=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig();}else({sessionFile,api}=require(ROOT+'/tools/creator-auth.cjs'));const c=new TelegramClient(new StringSession(fs.readFileSync(sessionFile,'utf8').trim()),api.apiId,api.apiHash,{connectionRetries:1,requestRetries:1,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});c.restorationOwnerId=identity.id;return c;}
const accountSuffix=c=>!c.restorationOwnerId||c.restorationOwnerId===OWNER?'':c.restorationOwnerId==='7586552066'?'-kira':'-'+c.restorationOwnerId;
async function openDb(){const {readPostgresAppDbConfig}=await import('file:///'+REPO.replace(/\\/g,'/')+'/src/platform/db/postgres/config.mts');const c=new(require('pg').Client)({...readPostgresAppDbConfig(process.env),connectionTimeoutMillis:5000,query_timeout:15000,application_name:'restoration-v2',options:'-c search_path=pg_catalog -c timezone=UTC'});await c.connect();return c;}
const rpcClients=new WeakMap(),creationRpcClients=new WeakMap(),creationClientIds=new WeakMap();
async function rpc(c,request,clientId){if(clientId)creationClientIds.set(request,clientId);const creation=request.className==='channels.CreateChannel',gates=creation?creationRpcClients:rpcClients;let gate=gates.get(c);if(!gate){const file=path.join(FOLDER,(creation?'rpc-cooldown-create':c.restorationBot?'rpc-cooldown-bot':'rpc-cooldown')+accountSuffix(c)+'.json');gate=require('./rpc-gate.cjs').createRpcGate({invoke:async r=>{if(creation)await require('./graduates-live.cjs').checkCreation(creationClientIds.get(r));return await c.invoke(r);},sleep,load:()=>read(file)?.nextAt||0,save:nextAt=>save(file,{nextAt}),onWait:w=>report('account_cooldown',w)});gates.set(c,gate);}return await gate(request);}
const createSerial=require('./create-gate.cjs').createGate({load:()=>read(path.join(FOLDER,'create-gate.json'))?.nextAt||0,save:nextAt=>save(path.join(FOLDER,'create-gate.json'),{nextAt}),sleep});
let senderTail=Promise.resolve();
async function sendAsOwner(op,c,peer){let release;const previous=senderTail;senderTail=new Promise(r=>release=r);await previous;try{const file=path.join(FOLDER,'owner-send-cooldown'+accountSuffix(c)+'.json');await sleep(Math.max(0,(read(file)?.nextAt||0)-Date.now()));const result=await require('./owner-send.cjs').sendOwner(op,{client:c,peer,readFile:fs.readFileSync});save(file,{nextAt:Date.now()+(result.retryAfter!==undefined?(result.retryAfter+1)*1000:ownerIntervalMs)});return result;}finally{release();}}
async function restore(plan,c,telegram,adminBot,{joinUnicorn,onPrepared,folder=FOLDER,invokeRpc=rpc,sendOperation,allowedAuthors,verifyInvitation}={}){
 const rpc=invokeRpc;
 const authors=()=>allowedAuthors||[state.ownerId,BOT];
 const file=path.join(folder,'client-'+plan.clientId+'.json'),state=read(file)||{version:2,clientId:plan.clientId,sourceChatId:plan.sourceChatId};
 if(state.completedAt){if(state.planHash!==plan.planHash)throw Error('plan_changed');return state;}
 if(state.skipped)return state;
 require('./account.cjs').bindOwner(state,c.restorationOwnerId||OWNER);
 require('./sender.cjs').bindSender(state,read(path.join(folder,'settings.json'))||{},plan.clientId);
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(file+'.lock');
 if(adminBot&&state.steps?.bot_admin?.result?.notRequired)delete state.steps.bot_admin;
 let lastProgress=0;
 const persist=async()=>{save(file,state);if(Date.now()-lastProgress>60000){lastProgress=Date.now();report('group_progress',{clientId:plan.clientId,chatId:state.chatId,done:Object.values(state.deliveries||{}).filter(d=>d.done).length,total:plan.operations.length});}};
 const channel=()=>new Api.InputChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)});
 const peer=()=>new Api.InputPeerChannel({channelId:bi(state.channel.id),accessHash:bi(state.channel.accessHash)});
 async function full(){const f=await rpc(c,new Api.channels.GetFullChannel({channel:channel()}));const e=f.chats.find(x=>String(x.id)===state.channel.id);if(!e?.creator||!e.megagroup||e.left||e.username)throw Error('target_not_private_owned_supergroup');return f;}
 async function allMessages(){const out=[];for await(const m of c.iterMessages(peer(),{}))if(m.className==='Message')out.push(m);return out.sort((a,b)=>a.id-b.id);}
 async function reconcile(op){return require('./owner-send.cjs').findReceipt(op,await c.getMessages(peer(),{limit:100}),authors());}
 async function verify(){const f=await full();if(f.fullChat.hiddenPrehistory)throw Error('history_hidden');const all=await allMessages(),copies=require('./verify.cjs').restoredCopies(plan,all,authors());for(let i=0;i<plan.operations.length;i++){const op=plan.operations[i],m=copies[i];if(!require('./telegram-text.cjs').sameTelegramText(op.text,m.message||'')||Number(state.deliveries?.[op.key]?.result?.messageId)!==m.id||String(m.senderId)!==(state.deliveries[op.key].result.senderId||BOT))throw Error('history_order_hash_or_receipt_mismatch');if(op.file&&Number(m.media?.document?.size)!==op.file.bytes)throw Error('file_size_mismatch');}
  const pins=[];for await(const m of c.iterMessages(peer(),{filter:new Api.InputMessagesFilterPinned()}))pins.push(m.id);
  const expected=plan.operations.filter(o=>o.pin).map(o=>state.deliveries[o.key].result.messageId).sort((a,b)=>a-b);if(JSON.stringify(pins.sort((a,b)=>a-b))!==JSON.stringify(expected))throw Error('pins_mismatch');
  if(state.avatar?.status==='applied'&&String(f.fullChat.chatPhoto?.id)!==state.avatar.targetPhotoId)throw Error('avatar_mismatch');
  const n=await rpc(c,new Api.account.GetNotifySettings({peer:new Api.InputNotifyPeer({peer:peer()})}));if(n.muteUntil<Date.now()/1000+86400)throw Error('not_muted');return{messages:copies.length,pins:pins.length,historyVisible:true};
 }
 const select='SELECT id,client_name,client_status,telegram_general_chat_id,telegram_personal_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE id=$1';
 async function stage(name,uncertain){
  if(name==='unicorn_join')return joinUnicorn?await joinUnicorn(plan,state):{notRequired:true};
  if(name==='early_invite')return joinUnicorn?await stage('invite',uncertain):{notRequired:true};
  if(name==='unicorn_join_early')return joinUnicorn?await joinUnicorn(plan,state,{partial:true}):{notRequired:true};
  if(name==='preflight'){const db=await openDb();try{const row=(await db.query(select,[plan.clientId])).rows[0];if(!require(ROOT+'/tools/rules.cjs').eligibleStudent(row||{})||require('./identity.cjs').normalizeChatId(row.telegram_general_chat_id)!==plan.sourceChatId)throw Error('source_client_mismatch');state.previous=row;await persist();return{eligible:true};}finally{await db.end();}}
  if(name==='create'){
   if(!state.channel){
    let e;
    if(uncertain){const ds=await c.getDialogs({limit:250});const found=ds.filter(d=>d.entity.className==='Channel'&&d.entity.creator&&d.entity.megagroup&&d.title===plan.title&&d.entity.date*1000>=state.steps.create.intentAt-10000);if(found.length!==1)throw Error('creation_outcome_unresolved');e=found[0].entity;}
    else{const result=await createSerial(()=>rpc(c,new Api.channels.CreateChannel({title:plan.title,about:'',megagroup:true}),plan.clientId));e=result.chats.find(e=>e.className==='Channel'&&e.megagroup&&e.creator);if(!e)throw Error('creation_unverified');}
    state.channel={id:String(e.id),accessHash:String(e.accessHash),createdAt:Date.now()};state.chatId=String(-1000000000000n-BigInt(state.channel.id));await persist();
   }
   await full();return{chatId:state.chatId};
  }
  if(name==='history'){let f=await full();if(f.fullChat.hiddenPrehistory)await rpc(c,new Api.channels.TogglePreHistoryHidden({channel:channel(),enabled:false}));f=await full();if(f.fullChat.hiddenPrehistory)throw Error('history_not_visible');return{visible:true};}
  if(name==='bot'){
   let ps=await rpc(c,new Api.channels.GetParticipants({channel:channel(),filter:new Api.ChannelParticipantsRecent(),offset:0,limit:200,hash:bi(0)}));
   if(!ps.participants.some(p=>String(p.userId)===BOT)){const bot=await c.getEntity('veu_support_bot');if(String(bot.id)!==BOT||!bot.bot)throw Error('bot_identity_mismatch');await rpc(c,new Api.channels.InviteToChannel({channel:channel(),users:[await c.getInputEntity(bot)]}));ps=await rpc(c,new Api.channels.GetParticipants({channel:channel(),filter:new Api.ChannelParticipantsRecent(),offset:0,limit:200,hash:bi(0)}));}
   const ids=ps.participants.map(p=>String(p.userId)).sort();if(ids.join(',')!==[state.ownerId,BOT].sort().join(','))throw Error('unexpected_initial_members');return{members:2};
  }
  if(name==='bot_admin'||name==='bot_admin_restore'){if(!adminBot){if(state.botPermissions)await require('./bot-admin.cjs').ensureBotRights(c,channel(),state,persist,false,request=>rpc(c,request));return{notRequired:true};}return await require('./bot-admin.cjs').ensureBotRights(c,channel(),state,persist,name==='bot_admin',request=>rpc(c,request));}
  if(name==='avatar'){
   // Telegram may reject photo updates immediately after creating a group.
   await sleep(Math.max(0,(state.channel.createdAt||state.steps.bot?.intentAt||0)+15000-Date.now()));
   const a=await require(ROOT+'/tools/cached-avatar.cjs').readCachedAvatar(plan.sourceChatId);if(!a)return state.avatar={status:'no_source_avatar'};
   const f=await full(),photoId=String(f.fullChat.chatPhoto?.id||'');if(state.avatar?.sourceSha256===a.sha256&&state.avatar.targetPhotoId===photoId)return state.avatar;
   if(state.avatarIntent){if(photoId&&photoId!==state.avatarIntent.oldId){state.avatar={status:'applied',sourceSha256:a.sha256,targetPhotoId:photoId,reconciled:true};return state.avatar;}if(state.lastError==='FLOOD'){delete state.avatarIntent;await persist();}else throw Error('avatar_outcome_unresolved');}
   state.avatarIntent={oldId:photoId,sha256:a.sha256};await persist();const {CustomFile}=require('telegram/client/uploads');const actor=adminBot||c;const file=await actor.uploadFile({file:new CustomFile('group-avatar.jpg',a.bytes,a.path),workers:1});const bp=adminBot?await require('./bot-admin.cjs').botPeer(adminBot,state.chatId):null;await rpc(actor,new Api.channels.EditPhoto({channel:bp?new Api.InputChannel({channelId:bp.channelId,accessHash:bp.accessHash}):channel(),photo:new Api.InputChatUploadedPhoto({file})}));const after=await full();state.avatar={status:'applied',sourceSha256:a.sha256,targetPhotoId:String(after.fullChat.chatPhoto?.id)};return state.avatar;
  }
  if(name==='mute'){await rpc(c,new Api.account.UpdateNotifySettings({peer:new Api.InputNotifyPeer({peer:peer()}),settings:new Api.InputPeerNotifySettings({muteUntil:2147483647,silent:true})}));return{muted:true};}
  if(name==='verify'||name==='final_verify'){const result=await verify();if(name==='final_verify'){const db=await openDb();try{const row=(await db.query(select,[plan.clientId])).rows[0];if(row.secured_general_chat_id!==state.chatId||row.secured_general_chat_invitation_link!==state.invitation)throw Error('final_sql_mismatch');}finally{await db.end();}}return result;}
  if(name==='invite'){
   if(!state.invitation){if(uncertain){const r=await rpc(c,new Api.messages.GetExportedChatInvites({peer:peer(),adminId:new Api.InputUserSelf(),limit:100}));const xs=r.invites.filter(i=>!i.revoked&&i.title==='restoration v2 '+plan.clientId);if(xs.length!==1)throw Error('invite_outcome_unresolved');state.invitation=xs[0].link;}else{const r=await rpc(c,new Api.messages.ExportChatInvite({peer:peer(),title:'restoration v2 '+plan.clientId,requestNeeded:false}));if(!r.link||r.revoked)throw Error('invite_invalid');state.invitation=r.link;}await persist();}
   if(verifyInvitation)return await verifyInvitation(state,c,peer());
   const r=await rpc(c,new Api.messages.CheckChatInvite({hash:state.invitation.split('/').at(-1).replace(/^\+/,'')}));if(String(r.chat?.id)!==state.channel.id)throw Error('invite_wrong_group');return{verified:true};
  }
  if(name==='sql'){const db=await openDb();try{return await require('./bind.cjs').bindSecured(db,plan,state);}finally{await db.end();}}
  throw Error('unknown_stage');
 }
 try{await runJob(plan,state,{save:persist,sleep,stage,reconcile,prepared:onPrepared,pin:async(op,r)=>{const f=await full();if(f.fullChat.pinnedMsgId!==r.messageId)await rpc(adminBot||c,new Api.messages.UpdatePinnedMessage({peer:adminBot?await require('./bot-admin.cjs').botPeer(adminBot,state.chatId):peer(),id:r.messageId,silent:true}));return{messageId:r.messageId};},send:async op=>{
  if(sendOperation)return await sendOperation(op,state,c,peer());
  if(state.senderMode==='owner')return await sendAsOwner(op,c,peer());
  const input={chatId:state.chatId,text:op.text};if(op.file){const data=fs.readFileSync(op.file.path);if(data.length!==op.file.bytes||hash(data)!==op.file.sha256)throw Error('attachment_hash_changed');input.attachment={file:new Blob([data]),filename:op.file.name};}
  const r=await telegram.sendOne(input);if(r.kind==='client-failure')return await reconcile(op);if(!r.response.ok){if(r.response.error_code===429&&Number.isFinite(r.response.parameters?.retry_after))return{retryAfter:r.response.parameters.retry_after};return{rejected:true,code:r.response.error_code};}
  const m=r.response.result;if(String(m.chat.id)!==state.chatId||String(m.from?.id)!==BOT)throw Error('send_identity_mismatch');return{messageId:m.message_id,senderId:BOT};
 }});delete state.lastError;delete state.lastFailure;await persist();report('group_complete',{clientId:plan.clientId,chatId:state.chatId,messages:plan.operations.length,pins:plan.pins});return state;}catch(e){if(e.code==='excluded_graduate'){delete state.steps.create.intentAt;require('./graduates.cjs').markSkipped(state,'graduated');await persist();return state;}if(adminBot&&state.botPermissions&&!state.steps?.bot_admin_restore?.done){try{await require('./bot-admin.cjs').ensureBotRights(c,channel(),state,persist,false,request=>rpc(c,request));if(state.steps?.bot_admin){state.steps.bot_admin.done=false;delete state.steps.bot_admin.intentAt;}await persist();}catch{state.permissionCleanupRequired=true;await persist();}}throw e;}finally{release();}
}
module.exports={ROOT,REPO,FOLDER,BOT,OWNER,Api,bi,read,save,sleep,report,openCreator,creatorIdentity,openDb,rpc,restore};
