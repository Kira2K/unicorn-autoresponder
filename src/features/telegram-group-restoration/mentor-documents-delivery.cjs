const fs=require('node:fs'),path=require('node:path');
const {FOLDER,ROOT,REPO,read,save,openCreator,report}=require('./live.cjs');
const {hash}=require('./plan.cjs');
const ACCOUNT='8222949251',CHAT='-1003187558078',TOPIC=20934;
const NOTICE='Я добавила аккаунт саппорта @veu_support с админскими правами во все группы.';
const CAPTION='1. Первый файл - наша текущуая SQL ученики=>ментор. Там нет половины и куча ошибок\n2. Второй файл - состояние из удаленных групп, соответствует действительности. Обратите внимание, что у нас есть ученики без ментора и это нормально!!\n3. 3ий файл - различия между первыми двумя\n\n\n\nИсправьте сегодня весь инконсистенси, а также вышлите менторам приглашение в их чаты. Это можно сделать через нотифаер! Но помните, что те кто отправит ментору приглашение не в тот чат или забудет про ментора, проведет выходные в подвале :D';
function readiness(targets,joins,admins){
 if(!targets?.length)throw Error('support_targets_missing');
 const match=(rows,t)=>rows?.find(r=>r.clientId===t.clientId&&r.chatId===t.chatId);
 return targets.every(t=>match(joins?.groups,t)?.verified===true&&match(admins?.groups,t)?.status==='admin');
}
async function main(options={}){
 const albumOnly=options.albumOnly??process.argv.includes('--album-only');
 const targets=read(path.join(FOLDER,'support-self-join',ACCOUNT,'manifest.json'))?.targets;
 if(!albumOnly&&!readiness(targets,read(path.join(FOLDER,'support-self-join',ACCOUNT,'report.json')),read(path.join(FOLDER,'support-admin',ACCOUNT,'report.json')))){
  report('mentor_delivery_waiting',{reason:'support_membership_or_admin_incomplete'});return;
 }
 const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));
 const c=openCreator('kira'),file=options.receiptFile||path.join(FOLDER,'mentor-documents-delivery.json');
 const caption=options.caption??CAPTION;
 const files=['01-sql.html','02-groups.html','04-differences-filtered.html'].map(n=>path.join(options.documentFolder||path.join(REPO,'storage/mentor-audit'),n));
 const hashes=files.map(f=>hash(fs.readFileSync(f)));let receipt=read(file)||{chatId:CHAT,topicId:TOPIC,hashes};
 try{
  if(JSON.stringify(receipt.hashes)!==JSON.stringify(hashes)||receipt.chatId!==CHAT||receipt.topicId!==TOPIC||receipt.captionHash&&receipt.captionHash!==hash(caption))throw Error('mentor_delivery_payload_changed');
  receipt.captionHash=hash(caption);
  await c.connect();if(String((await c.getMe()).id)!=='7586552066')throw Error('mentor_delivery_account_mismatch');
  const dialog=(await c.getDialogs({limit:300})).find(d=>String(d.id)===CHAT);if(!dialog)throw Error('mentor_delivery_chat_missing');
  const peer=dialog.inputEntity,topic=(await c.getMessages(peer,{ids:[TOPIC]}))[0];
  if(topic?.action?.className!=='MessageActionTopicCreate'||topic.action.title!=='Задачи')throw Error('mentor_delivery_topic_mismatch');
  const inTopic=m=>(m.replyTo?.replyToTopId||m.replyTo?.replyToMsgId)===TOPIC&&String(m.senderId)==='7586552066';
  const recent=()=>c.getMessages(peer,{limit:200});
  if(!albumOnly&&!receipt.notice?.done){
   if(receipt.notice?.intent){const matches=(await recent()).filter(m=>inTopic(m)&&m.message===NOTICE&&m.date*1000>=receipt.notice.intent-5000);if(matches.length!==1)throw Error('mentor_notice_outcome_unresolved');receipt.notice={...receipt.notice,done:true,messageId:matches[0].id};save(file,receipt);}
   else{receipt.notice={intent:Date.now()};save(file,receipt);const m=await c.sendMessage(peer,{message:NOTICE,replyTo:TOPIC,parseMode:false});const v=(await c.getMessages(peer,{ids:[m.id]}))[0];if(!inTopic(v)||v.message!==NOTICE)throw Error('mentor_notice_verification_failed');receipt.notice={...receipt.notice,done:true,messageId:m.id};save(file,receipt);}
  }
  async function verifyAlbum(rows){
   rows=rows.filter(inTopic).sort((a,b)=>a.id-b.id);
   if(rows.length!==3||!rows[0].groupedId||!rows.every(m=>String(m.groupedId)===String(rows[0].groupedId))||rows[0].message!==caption||rows.slice(1).some(m=>m.message)||(receipt.notice?.done&&rows[0].id<=receipt.notice.messageId))throw Error('mentor_album_verification_failed');
   for(let i=0;i<3;i++){if(!rows[i].media?.document||hash(await c.downloadMedia(rows[i],{}))!==hashes[i])throw Error('mentor_attachment_verification_failed');}
   return rows.map(m=>m.id);
  }
  if(!receipt.album?.done){
   if(receipt.album?.intent){const rows=await recent(),heads=rows.filter(m=>inTopic(m)&&m.message===caption&&m.date*1000>=receipt.album.intent-5000);if(heads.length!==1||!heads[0].groupedId)throw Error('mentor_album_outcome_unresolved');receipt.album={...receipt.album,done:true,messageIds:await verifyAlbum(rows.filter(m=>String(m.groupedId)===String(heads[0].groupedId)))};save(file,receipt);}
   else{receipt.album={intent:Date.now()};save(file,receipt);const sent=await c.sendFile(peer,{file:files,caption:[caption,'',''],forceDocument:true,replyTo:TOPIC,parseMode:false,workers:1});const rows=await c.getMessages(peer,{ids:sent.map(m=>m.id)});receipt.album={...receipt.album,done:true,messageIds:await verifyAlbum(rows)};save(file,receipt);}
  }
  receipt.done=!!receipt.notice?.done;save(file,receipt);report('mentor_documents_delivered',{messageIds:receipt.album.messageIds,noticeSent:!!receipt.notice?.done});
 }finally{await c.disconnect();release();}
}
module.exports={readiness,NOTICE,CAPTION,main};
if(require.main===module)main().catch(e=>{report('mentor_delivery_stopped',{error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'mentor_delivery_failed'});process.exitCode=1;});
