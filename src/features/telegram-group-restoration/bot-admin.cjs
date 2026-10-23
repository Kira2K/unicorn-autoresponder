const fs=require('node:fs');
const {TelegramClient,Api}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger'),bi=require('big-integer');
async function openBotAdmin({apiId,apiHash,token,sessionFile}){
 const session=fs.existsSync(sessionFile)?fs.readFileSync(sessionFile,'utf8').trim():'';
 const c=new TelegramClient(new StringSession(session),apiId,apiHash,{connectionRetries:1,requestRetries:3,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});
 try{await c.start({botAuthToken:token});}catch(e){await c.disconnect().catch(()=>{});throw e;}const me=await c.getMe();
 if(String(me.id)!=='8897025258'||!me.bot)throw Error('admin_bot_identity_mismatch');
 fs.writeFileSync(sessionFile,c.session.save(),{mode:0o600});
 c._requestRetries=1;
 c.restorationBot=true;
 return c;
}
async function botPeer(bot,chatId){return await bot.getInputEntity(bi(chatId));}
function rights(enabled){return new Api.ChatAdminRights(enabled?{changeInfo:true,pinMessages:true}:{});}
async function setBotRights(creator,channel,enabled){
 const user=await creator.getEntity('veu_support_bot');if(String(user.id)!=='8897025258'||!user.bot)throw Error('admin_bot_identity_mismatch');
 await creator.invoke(new Api.channels.EditAdmin({channel,userId:await creator.getInputEntity(user),adminRights:rights(enabled),rank:enabled?'VEU restoration':''}));
}
function snapshotRights(participant){return Object.fromEntries(Object.entries(participant?.adminRights||{}).filter(([,v])=>typeof v==='boolean'&&v));}
async function ensureBotRights(creator,channel,state,persist,enabled,invoke){
 const user=await creator.getEntity('veu_support_bot');if(String(user.id)!=='8897025258'||!user.bot)throw Error('admin_bot_identity_mismatch');
 const participant=await creator.getInputEntity(user);
 const current=await invoke(new Api.channels.GetParticipant({channel,participant}));
 if(!state.botPermissions){state.botPermissions={rights:snapshotRights(current.participant),rank:current.participant.rank||''};await persist();}
 const desired=enabled?{...state.botPermissions.rights,other:true,changeInfo:true,pinMessages:true}:state.botPermissions.rights;
 const equal=(a,b)=>JSON.stringify(Object.entries(a).sort())===JSON.stringify(Object.entries(b).sort());
 if(!equal(snapshotRights(current.participant),desired)){
  await invoke(new Api.channels.EditAdmin({channel,userId:await creator.getInputEntity(user),adminRights:new Api.ChatAdminRights(desired),rank:enabled?'VEU restoration':state.botPermissions.rank}));
 }
 const verified=await invoke(new Api.channels.GetParticipant({channel,participant}));
 if(!equal(snapshotRights(verified.participant),desired))throw Error('bot_rights_verification_failed');
 return {temporary:enabled,verified:true};
}
module.exports={openBotAdmin,botPeer,setBotRights,rights,snapshotRights,ensureBotRights};
