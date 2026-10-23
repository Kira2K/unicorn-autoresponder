const fs=require('node:fs'),path=require('node:path');
const {ROOT,FOLDER,openCreator,read,save,sleep,report}=require('./live.cjs');
const TARGET='kiraSamsonova';
function latestFlood(){let last;for(const name of fs.readdirSync(FOLDER).filter(n=>n.endsWith('.out.log'))){for(const line of fs.readFileSync(path.join(FOLDER,name),'utf8').split('\n')){if(!line.includes('account_cooldown'))continue;try{const e=JSON.parse(line);if(e.code?.startsWith('FLOOD')&&(!last||e.at>last.at))last=e;}catch{}}}return last;}
async function notify(kind,summary,flood){
 const file=path.join(FOLDER,'notify-'+kind+'.json'),old=read(file);if(old?.done)return;
 const c=openCreator('unicorn');try{
  await c.connect();if(String((await c.getMe()).id)!=='8805256389')throw Error('notification_account_mismatch');
  const user=await c.getEntity(TARGET);if(user.username?.toLowerCase()!==TARGET.toLowerCase()||user.bot)throw Error('notification_recipient_mismatch');
  const skipped=summary.groups.filter(g=>g.status==='skipped').length,done=summary.groups.filter(g=>g.status==='complete').length,messages=summary.groups.reduce((n,g)=>n+g.messages,0),total=summary.groups.reduce((n,g)=>n+g.total,0);
  const text=old?.text||('Восстановление групп VEU: '+(kind==='complete'?'завершено.':'Telegram вернул '+flood.code+' для '+flood.method+'.')+'\nГотово групп: '+done+'/114. Исключено выпускников: '+skipped+'. Сообщений: '+messages+'/'+total+'.'+(kind==='flood'?' Очередь соблюдает паузы Telegram; срок снятия ограничения неизвестен.':' Итоговый файл приглашений отправлен в согласованный чат.')+'\nГрупп с ошибкой проверки: '+summary.groups.filter(g=>g.error&&g.status!=='complete').length+'.');
  let sent;
  if(old?.intentAt){const matches=(await c.getMessages(user,{limit:100})).filter(m=>String(m.senderId)==='8805256389'&&m.message===text);if(matches.length!==1)throw Error('notification_outcome_unresolved');sent=matches[0];}
  else{save(file,{intentAt:Date.now(),recipientId:String(user.id),text});sent=await c.sendMessage(user,{message:text,parseMode:false,linkPreview:false});}
  if(sent.message!==text)throw Error('notification_verification_failed');
  save(file,{done:true,at:new Date().toISOString(),recipientId:String(user.id),messageId:sent.id});report('status_notification_sent',{kind,recipientId:String(user.id),messageId:sent.id});
 }finally{await c.disconnect();}
}
async function main(){const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'notification.lock'));try{for(;;){const r=read(path.join(FOLDER,'report.json'));if(r){const flood=latestFlood();if(flood&&!read(path.join(FOLDER,'notify-flood.json'))?.done)await notify('flood',r,flood);if(read(path.join(FOLDER,'completed.json'))){await notify('complete',r);return;}}await sleep(30000);}}finally{release();}}
if(require.main===module)main().catch(e=>{report('status_notification_blocked',{code:e.errorMessage||e.code||'notification_failed'});process.exitCode=1;});
