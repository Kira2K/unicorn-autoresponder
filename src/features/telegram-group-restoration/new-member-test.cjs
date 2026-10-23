const fs=require('node:fs'),path=require('node:path');
const {REPO,FOLDER,read,save,report,Api}=require('./live.cjs');
const {hash}=require('./plan.cjs');
async function testNewMember(plan,state){
 const receiptFile=path.join(FOLDER,'new-member-test.json');
 if(read(receiptFile)?.done)return;
 const cfg=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig();
 const {TelegramClient}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger');
 const c=new TelegramClient(new StringSession(fs.readFileSync(path.join(REPO,'.telegram-session'),'utf8').trim()),cfg.apiId,cfg.apiHash,{connectionRetries:1,requestRetries:1,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});
 try{
  await c.connect();const me=await c.getMe();if(String(me.id)!=='7586552066')throw Error('test_account_mismatch');
  const inviteHash=state.invitation.split('/').at(-1).replace(/^\+/,'');
  const check=await c.invoke(new Api.messages.CheckChatInvite({hash:inviteHash}));
  if(check.className==='ChatInviteAlready'&&!read(receiptFile)?.joinIntent)throw Error('test_account_already_member');
  save(receiptFile,{joinIntent:true,chatId:state.chatId});
  if(check.className!=='ChatInviteAlready')await c.invoke(new Api.messages.ImportChatInvite({hash:inviteHash}));
  const d=(await c.getDialogs({limit:250})).find(d=>String(d.id)===state.chatId);if(!d)throw Error('test_group_not_visible');
  const messages=[];for await(const m of c.iterMessages(d.inputEntity,{}))if(m.className==='Message')messages.push(m);
  messages.sort((a,b)=>a.id-b.id);
  require('./verify.cjs').restoredCopies(plan,messages);
  save(receiptFile,{done:true,chatId:state.chatId,messages:messages.length,verifiedAt:new Date().toISOString()});
  await c.invoke(new Api.channels.LeaveChannel({channel:await c.getInputEntity(d.entity)}));
  report('new_member_history_verified',{chatId:state.chatId,messages:messages.length});
 }finally{await c.disconnect();}
}
module.exports={testNewMember};
