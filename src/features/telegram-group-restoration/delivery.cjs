const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {ROOT,REPO,FOLDER,read,save,report,openDb}=require('./live.cjs');
const {buildAudience}=require('./audience.cjs');
const {hash}=require('./plan.cjs');
const CAPTION='Я собрал пригласительные ссылки для всех, кто был в чатах, чтобы люди могли войти из одного места';
async function audience(states){
 const sql=await openDb();let clients,staff,mentors;
 try{clients=(await sql.query('SELECT id,client_name,telegram_personal_chat_id FROM noco.clients WHERE coalesce(__nc_deleted,false)=false')).rows;staff=(await sql.query('SELECT telegram_user_id,telegram_username FROM noco.users WHERE active=true')).rows;mentors=(await sql.query('SELECT name FROM noco.mentors WHERE coalesce(__nc_deleted,false)=false')).rows;}finally{await sql.end();}
 const d=new DatabaseSync(ROOT+'/archive/archive.sqlite',{readOnly:true});
 try{
  const users=new Map(d.prepare('SELECT id,payload FROM users').all().map(r=>[r.id,JSON.parse(r.payload)]));
  const mentorNames=new Set(mentors.map(m=>String(m.name||'').trim().toLowerCase()));
  const staffIds=staff.map(s=>s.telegram_user_id).filter(Boolean);
  const decisions=read(path.join(FOLDER,'role-decisions.json'))||{};
  if(decisions.source==='user-confirmed')staffIds.push(...(decisions.staffIds||[]));
  const fullNames=new Map();for(const [id,u]of users){const name=[u.first_name,u.last_name].filter(Boolean).join(' ').trim().toLowerCase();const ids=fullNames.get(name)||[];ids.push(id);fullNames.set(name,ids);}
  for(const name of mentorNames){const ids=fullNames.get(name);if(ids?.length===1&&name.includes(' '))staffIds.push(ids[0]);}
  const groups=new Map(states.map(s=>[s.sourceChatId,{clientId:s.clientId,title:s.title,invitation:s.invitation}]));
  return buildAudience({members:d.prepare('SELECT chat_id,user_id FROM memberships').all().filter(m=>groups.has(String(m.chat_id))),users,clients,staffIds,staffTags:staff.map(s=>s.telegram_username),studentIds:decisions.source==='user-confirmed'?decisions.studentIds||[]:[],ignoredIds:decisions.source==='user-confirmed'?decisions.ignoredIds||[]:[],groups});
 }finally{d.close();}
}
async function deliverOnce(receipt,sha,adapters){
 if(receipt.done){if(receipt.sha256!==sha)throw Error('delivered_file_changed');return receipt;}
 if(receipt.intentAt){const found=await adapters.reconcile();if(!found)throw Error('file_delivery_unresolved');const done={...receipt,...found,done:true};await adapters.save(done);return done;}
 const intent={intentAt:Date.now(),sha256:sha};await adapters.save(intent);
 const found=await adapters.send();const done={...intent,...found,done:true};await adapters.save(done);return done;
}
async function publish(states,{client}={}){
 states=require('./graduates.cjs').validateFinal(states);
 const a=await audience(states);
 save(path.join(FOLDER,'audience-review.json'),{people:a.people.map(p=>({id:p.id,name:p.name,username:p.username,groups:p.groups.length})),unresolved:a.unresolved});
 if(a.unresolved.length)throw Error('audience_unresolved_'+a.unresolved.length);
 const file=path.join(FOLDER,'veu-restored-group-invitations.html');fs.writeFileSync(file,a.html,{mode:0o600});
 const receiptFile=path.join(FOLDER,'file-delivery.json');
 const cfg=require(REPO+'/src/integrations/telegram/tools/responses-application/index.ts').getConfig();
 const {TelegramClient}=require('telegram'),{StringSession}=require('telegram/sessions'),{Logger,LogLevel}=require('telegram/extensions/Logger');
 const c=client||new TelegramClient(new StringSession(fs.readFileSync(path.join(REPO,'.telegram-session'),'utf8').trim()),cfg.apiId,cfg.apiHash,{connectionRetries:1,requestRetries:1,floodSleepThreshold:0,baseLogger:new Logger(LogLevel.NONE)});
 try{
  if(!client)await c.connect();const me=await c.getMe();if(String(me.id)!=='7586552066')throw Error('delivery_account_mismatch');
  const d=(await c.getDialogs({limit:250})).find(d=>String(d.id)==='-1003187558078');if(!d)throw Error('delivery_chat_unavailable');
  const topic=(await c.getMessages(d.inputEntity,{ids:[20934]}))[0];if(topic?.action?.className!=='MessageActionTopicCreate')throw Error('delivery_topic_mismatch');
  const result=await deliverOnce(read(receiptFile)||{},a.sha256,{
   save:r=>save(receiptFile,r),
   reconcile:async()=>{const matches=(await c.getMessages(d.inputEntity,{limit:100})).filter(m=>String(m.senderId)===String(me.id)&&m.message===CAPTION&&m.media?.document&&(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===20934);if(matches.length!==1)throw Error('file_delivery_unresolved');const m=matches[0];const bytes=await c.downloadMedia(m,{});if(hash(bytes)!==a.sha256)throw Error('delivered_file_hash_mismatch');return{messageId:m.id};},
   send:async()=>{const sent=await c.sendFile(d.inputEntity,{file,caption:CAPTION,forceDocument:true,replyTo:20934,workers:1});const verified=(await c.getMessages(d.inputEntity,{ids:[sent.id]}))[0];if(verified?.message!==CAPTION||!verified.media?.document||Number(verified.media.document.size)!==Buffer.byteLength(a.html)||(verified.replyTo?.replyToTopId||verified.replyTo?.replyToMsgId)!==20934)throw Error('file_delivery_verification_failed');return{messageId:sent.id,chatId:'-1003187558078',topicId:20934};}
  });report('file_delivered',{messageId:result.messageId,people:a.people.length});
 }finally{if(!client)await c.disconnect();}
}
module.exports={audience,publish,deliverOnce,CAPTION};
