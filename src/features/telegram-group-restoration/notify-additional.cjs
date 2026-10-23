const path=require('node:path');const {ROOT,FOLDER,read,save,openCreator,sleep,report}=require('./live.cjs');const {OUT}=require('./prepare-additional-archive.cjs');const {hash}=require('./plan.cjs');
async function notify(kind){const file=path.join(OUT,'notify-'+kind+'.json');if(read(file)?.done)return;
 let release;try{release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(FOLDER,'batch.lock'));}catch(e){if(e.message==='restoration_already_running')return;throw e;}
 const c=openCreator('unicorn');try{
  if(kind==='complete')await require('./audit-additional-complete.cjs').main();
  const audit=read(path.join(OUT,'final-audit.json')),summary=read(path.join(OUT,'report.json')),ready=summary.groups.filter(g=>g.status==='complete').length;
  const text=kind==='complete'?'Дополнительное восстановление VEU завершено.\nГотово групп: '+audit.complete+'/27. Публикаций: '+audit.published+'. Вложений: '+audit.files+'. Закрепов: '+audit.pins+'.\nВидимость истории, приглашения и SQL-привязки проверены. Итоговый файл приглашений готов локально.':'Дополнительное восстановление VEU требует проверки.\nСозданы все 27 групп. Полностью готовы: '+ready+'/27.\nПричина остановки: '+(read(path.join(OUT,'restore-status.json'))?.error||'unknown')+'. Подтверждённые сообщения и группы сохранены.';
  await c.connect();if(String((await c.getMe()).id)!=='8805256389')throw Error('additional_notify_sender_mismatch');const user=await c.getEntity('KiraSamsonova');if(String(user.id)!=='343610488')throw Error('additional_notify_recipient_mismatch');
  const result=await require('./delivery.cjs').deliverOnce(read(file)||{},hash(text),{save:r=>save(file,r),reconcile:async()=>{const matches=(await c.getMessages(user,{limit:100})).filter(m=>String(m.senderId)==='8805256389'&&m.message===text);if(matches.length!==1)return null;return{messageId:matches[0].id};},send:async()=>{const m=await c.sendMessage(user,{message:text,parseMode:false,linkPreview:false});if(String(m.senderId)!=='8805256389'||m.message!==text)throw Error('additional_notify_response_mismatch');return{messageId:m.id};}});
  report('additional_status_notified',{kind,messageId:result.messageId});
 }finally{await c.disconnect();release();}
}
async function main(){const release=require(ROOT+'/tools/restoration-lock.cjs').acquireLock(path.join(OUT,'notify.lock'));try{for(;;){
 if(read(path.join(OUT,'completed.json'))){await notify('complete');if(read(path.join(OUT,'notify-complete.json'))?.done)return;}
 else if(read(path.join(OUT,'restore-status.json'))?.status==='blocked'&&!read(path.join(OUT,'restore.lock')))await notify('blocked');
 await sleep(50000);
 }}finally{release();}}
if(require.main===module)main().catch(e=>{save(path.join(OUT,'notify-status.json'),{status:'needs_review',error:/^[\w:-]{1,120}$/.test(e.message)?e.message:'additional_notify_failed'});process.exitCode=1;});
