import type {OctoStore} from '../contracts.mts';
import type {WebClient} from '../../web-console/backend/types.ts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';

export const bridgeReportsChatId='-1003187558078';
const safe=(value:string)=>value.replace(/[\r\n\x00-\x1f\x7f]/g,' ').slice(0,180);
/** One durable send attempt per grant, including restarts and lost Telegram replies. */
export function createBridgeErrorReporter({store,client,sendOne,now=Date.now,waitingMs=120000}: {
 store:OctoStore;client(id:number):Promise<WebClient>;sendOne(input:SendOneInput):Promise<SendOneResult>;
 now?:()=>number;waitingMs?:number;
}){
 return async(profileId:number)=>{
  const p=await store.get(profileId),g=p?.grant,b=g?.bridgeClear;
  if(!p||!g||!b||g.clearMethod!=='bridge'||p.deletion||g.phase==='complete'||b.incident)return;
  const stalled=g.phase==='awaiting_close'&&g.pending==='clear'&&Number.isFinite(g.attemptedAt)&&now()-g.attemptedAt!>=waitingMs;
  if(g.phase!=='blocked'&&!stalled)return;
  const code=g.phase==='blocked'&&/^octo_[a-z0-9_]{1,100}$/.test(g.error??'')?g.error!:'octo_bridge_cleanup_delayed';
  let person:WebClient|undefined;try{person=await client(p.clientId);}catch{/* A missing client lookup must not suppress the technical report. */}
  b.incident={code,chatId:bridgeReportsChatId,attemptedAt:now(),state:'attempting'};
  // Revision CAS is the cross-process send claim. A loser never calls Telegram.
  await store.save(p);
  const text=[
   '⚠️ Не завершён доступ к Octo',
   `Ученик: ${safe(person?.fio||[person?.firstName,person?.lastName].filter(Boolean).join(' ')||`№${p.clientId}`)} (№${p.clientId})`,
   `Стек: ${safe(person?.primaryStack||'не указан')}`,
   `Профиль: ${p.locale.toUpperCase()} №${p.id}`,
   `Операция: ${g.id}`,
   `Код: ${code}`,
   stalled?'Очистка ожидает bridge более двух минут. Нужна проверка подключения.':'Операция остановлена для проверки. Не повторяем снятие пароля с неизвестным результатом.',
  ].join('\n');
  let outcome:NonNullable<typeof b.incident>;
  try{
   const result=await sendOne({chatId:bridgeReportsChatId,text});
   if(result.kind==='telegram-response')outcome=result.response.ok
    ?{...b.incident,state:'sent',messageId:result.response.result.message_id}
    :{...b.incident,state:'failed',errorCode:`telegram_${result.response.error_code}`};
   else outcome={...b.incident,state:['validation','configuration'].includes(result.failure.stage)?'failed':'uncertain',errorCode:`telegram_${result.failure.stage}`};
  }catch{outcome={...b.incident,state:'uncertain',errorCode:'telegram_send_outcome_unknown'};}
  // No retry after a send, even if receipt persistence fails or the process exits.
  const latest=await store.get(p.id);
  if(latest?.grant?.id===g.id&&latest.grant.bridgeClear?.incident?.attemptedAt===b.incident.attemptedAt){
   latest.grant.bridgeClear.incident=outcome;await store.save(latest);
  }
 };
}
