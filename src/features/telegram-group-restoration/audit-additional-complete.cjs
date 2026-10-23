const path=require('node:path'),fs=require('node:fs');
const {read,save,openDb,report}=require('./live.cjs'),{OUT}=require('./prepare-additional-archive.cjs'),{normalizeChatId}=require('./identity.cjs');
async function main(){
 const plans=read(path.join(OUT,'plans.json')),states=plans.map(p=>read(path.join(OUT,'client-'+p.clientId+'.json')));
 if(plans.length!==27||states.some(s=>!s?.completedAt&&!s?.skipped))throw Error('additional_completion_incomplete');
 const db=await openDb();let rows;try{rows=(await db.query('SELECT id,client_name,telegram_general_chat_id,secured_general_chat_id,secured_general_chat_invitation_link FROM noco.clients WHERE id=ANY($1::bigint[])',[plans.map(p=>p.clientId)])).rows;}finally{await db.end();}
 if(rows.length!==27)throw Error('additional_sql_scope_mismatch');const used=new Set(),groups=[];
 for(let i=0;i<plans.length;i++){const p=plans[i],s=states[i],row=rows.find(r=>String(r.id)===p.clientId);
  if(normalizeChatId(row.telegram_general_chat_id)!==p.sourceChatId)throw Error('additional_source_id_changed');
  if(s.skipped){groups.push({clientId:p.clientId,name:row.client_name,status:'skipped',reason:s.reason});continue;}
  if(used.has(s.chatId)||row.secured_general_chat_id!==s.chatId||row.secured_general_chat_invitation_link!==s.invitation)throw Error('additional_sql_binding_mismatch');used.add(s.chatId);
  if(!s.steps?.final_verify?.done||!s.steps?.final_verify?.result?.historyVisible||!s.steps?.invite?.done||!s.steps?.unicorn_join?.result?.joined||s.steps.unicorn_join.result.userId!=='8805256389')throw Error('additional_final_checks_missing');
  if(p.operations.some(op=>!s.deliveries[op.key]?.done||op.pin&&!s.steps['pin:'+op.key]?.done))throw Error('additional_operations_incomplete');
  const senders={};for(const d of Object.values(s.deliveries))senders[d.result.senderId]=(senders[d.result.senderId]||0)+1;
  groups.push({clientId:p.clientId,name:row.client_name,status:'complete',sourceChatId:p.sourceChatId,chatId:s.chatId,ownerId:s.ownerId,sourceMessages:p.sourceMessages,published:p.operations.length,files:p.operations.filter(o=>o.file).length,pins:p.pins,historyVisible:true,invitationVerified:true,sqlVerified:true,unicornMember:true,senders});
 }
 const result={at:new Date().toISOString(),total:groups.length,complete:groups.filter(g=>g.status==='complete').length,skipped:groups.filter(g=>g.status==='skipped').length,published:groups.reduce((n,g)=>n+(g.published||0),0),files:groups.reduce((n,g)=>n+(g.files||0),0),pins:groups.reduce((n,g)=>n+(g.pins||0),0),groups};
 save(path.join(OUT,'final-audit.json'),result);
 const lines=['Восстановление 27 дополнительных групп',new Date().toLocaleString('ru-RU',{timeZone:'Asia/Tbilisi'})+' — Тбилиси','Готово: '+result.complete+'. Пропущено: '+result.skipped+'. Публикаций: '+result.published+'. Файлов: '+result.files+'. Закрепов: '+result.pins+'.','SQL-привязки, приглашения и итоговые проверки сверены.',''];
 for(const g of groups)lines.push(g.name+' (ID '+g.clientId+') — '+g.status+(g.chatId?'; группа '+g.chatId+'; публикаций '+g.published+'; файлов '+g.files+'; закрепов '+g.pins+'; история видна; приглашение и SQL проверены':''));
 fs.writeFileSync(path.join(OUT,'final-report.txt'),lines.join('\n'),'utf8');report('additional_final_audit_passed',{groups:result.complete,skipped:result.skipped,published:result.published,files:result.files,pins:result.pins});
}
module.exports={main};
if(require.main===module)main().catch(e=>{report('additional_final_audit_failed',{error:e.message});process.exitCode=1;});
