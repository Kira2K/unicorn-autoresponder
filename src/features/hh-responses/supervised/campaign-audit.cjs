const normal=new Set(['limit_reached','hh_response_daily_limit_exceeded','manual_targets_only','no_new_targets','targets_processed','user_stop']);
function finalStatuses(rows){
 const statuses=new Map();
 const add=s=>{if(!s)return;const id=Number(s.dolphinProfileId);const key=Number.isSafeInteger(id)&&id>0?String(id):[s.market,s.clientName,s.commonChatId].join(':');statuses.set(key,s);};
 for(const row of rows){if(['client-final-status','client-skipped-before-run'].includes(row.kind))add(row.status);if(row.kind==='run-results')for(const s of row.results??[])add(s);}
 return [...statuses.values()];
}
function repairHint(error){
 const text=String(error||'');
 if(/ambiguous|неоднознач/i.test(text))return 'Устранить дубли канонической карточки, сохранив правильный аккаунт и историю.';
 if(/TUNNEL_CONNECTION_FAILED|proxy|CONNECT.*403/i.test(text))return 'Проверить доступ и авторизацию текущего прокси или обновить прокси профиля Dolphin.';
 if(/неправильные данные|invalid.credentials|auth.*(failed|login)|логин|парол/i.test(text))return 'Проверить логин и пароль в карточке HH соответствующего рынка; при необходимости восстановить доступ через почту.';
 if(/captcha|капч/i.test(text))return 'Проверить картинку и результат ограниченных попыток распознавания в журнале капч.';
 if(/resume|резюм/i.test(text))return 'Завершить или проверить резюме HH в этом профиле.';
 return 'Проверить индивидуальную ошибку в журнале; подтверждённую историю и очередь ручных вакансий сохранить.';
}
function auditMarket(market,rows,manifest,authDiagnostics=[]){
 const allStatuses=finalStatuses(rows),statuses=new Map(allStatuses.map(s=>[Number(s.dolphinProfileId),s])),started=new Set();
 for(const row of rows){if(row.kind==='client-lifecycle'&&['Dolphin profile started','automation profile lock planned','automation profile lock verified'].includes(row.event?.event))started.add(Number(row.dolphinProfileId));}
 const cleanup=[...started].map(id=>{const s=statuses.get(id);return {id,name:s?.clientName,stopped:s?.profileStopped===true,tagRemoved:s?.profileTagRemoved===true,tagVerified:s?.profileTagVerifiedAfterRemove===true,statusRestored:s?.profileStatusRestored===true,finalized:!!s};});
 const broken=allStatuses.filter(s=>s.error||s.telegramError||s.startButtonClicked&&!normal.has(s.autoResponderStopReason)).map(s=>{const diagnostic=authDiagnostics.findLast(d=>Number(d.id)===Number(s.dolphinProfileId));const category=rows.findLast(r=>r.kind==='hh-auth-diagnostic'&&Number(r.dolphinProfileId)===Number(s.dolphinProfileId))?.category;const alert=diagnostic?.dom?.alerts?.find(t=>/неправильные данные|invalid.*(credentials|password)|incorrect.*password/i.test(t));const reason=category||alert||s.error||s.telegramError||s.autoResponderStopReason||'unknown_terminal_reason';return {market,id:s.dolphinProfileId,name:s.clientName,reason,fix:repairHint(reason)};});
 for(const target of manifest?.blockedTargets||[]){const reason=(target.problems||[]).join('; ');broken.push({market,name:target.clientName,reason,fix:repairHint(reason),readinessBlocked:true});}
 return {market,cleanup,cleanupComplete:cleanup.every(c=>c.stopped&&c.tagRemoved&&c.tagVerified&&c.statusRestored&&c.finalized),broken};
}
function splitReport(lines,max=3500){const chunks=[];let current='';for(const original of lines){const line=String(original).slice(0,max);if(current.length+line.length+1>max){chunks.push(current);current='';}current+=(current?'\n':'')+line;}if(current)chunks.push(current);return chunks;}
module.exports={auditMarket,repairHint,splitReport,finalStatuses};
