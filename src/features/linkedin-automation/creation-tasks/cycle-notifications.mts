import {randomUUID} from 'node:crypto';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';
import type {WebClient} from '../../web-console/backend/types.ts';
export interface CycleNotice{taskId:number;clientId:number;url:string;token:string;recipient:'reports'|'student';chatId?:string;test?:boolean}
export function cycleNotificationStore(pool:SqlPool,database:CopyDatabase,localClientIds?:readonly number[],testChatId='-5216637594'){
 return{
  claim:():Promise<CycleNotice|undefined>=>writeTransaction(pool,database,async s=>{
   await s.query("UPDATE noco.linkedin_cycle_notifications SET state='uncertain',error_code='claim_expired' WHERE state='attempting' AND claimed_at<clock_timestamp()-interval '10 minutes' AND ($1::bigint[] IS NULL OR client_id=ANY($1))",[localClientIds??null]);
   const row=(await s.query("SELECT n.task_id,n.client_id,n.url,n.recipient,n.chat_id,c.client_role='фейк' AS is_test FROM noco.linkedin_cycle_notifications n JOIN noco.clients c ON c.id=n.client_id WHERE (($1::bigint[] IS NULL AND n.state='pending') OR (n.client_id=ANY($1) AND (n.state='pending' OR n.state='failed' AND n.error_code='local_delivery_pending'))) ORDER BY n.task_id,n.recipient FOR UPDATE OF n SKIP LOCKED LIMIT 1",[localClientIds??null])).rows[0];
   if(!row)return undefined;const token=randomUUID();
   await s.query("UPDATE noco.linkedin_cycle_notifications SET state='attempting',claim_token=$2,claimed_at=clock_timestamp(),error_code=NULL WHERE task_id=$1 AND recipient=$3",[row.task_id,token,row.recipient]);
   return{taskId:Number(row.task_id),clientId:Number(row.client_id),url:String(row.url),token,
    recipient:row.recipient as CycleNotice['recipient'],chatId:row.is_test===true?testChatId:row.chat_id?String(row.chat_id):undefined,...(row.is_test===true?{test:true}:{})};
  }),
  finish:(event:CycleNotice,state:'sent'|'failed'|'uncertain',messageId?:number,code?:string)=>writeTransaction(pool,database,
   s=>s.query("UPDATE noco.linkedin_cycle_notifications SET state=$3,message_id=$4,error_code=$5 WHERE task_id=$1 AND claim_token=$2 AND state='attempting' AND recipient=$6",[event.taskId,event.token,state,messageId??null,code??null,event.recipient]))
 };
}
/** One claimed delivery, one send attempt. Business completion is already committed. */
export async function deliverCycleNotification(deps:{store:ReturnType<typeof cycleNotificationStore>;
 client(id:number):Promise<Pick<WebClient,'firstName'|'lastName'|'fio'|'clientName'|'primaryStack'>>;
 sendOne(input:SendOneInput):Promise<SendOneResult>}){
 const event=await deps.store.claim();if(!event)return false;
 if(!event.chatId){await deps.store.finish(event,'failed',undefined,'recipient_missing');return true;}
 try{
  const c=await deps.client(event.clientId),name=[c.firstName,c.lastName].filter(Boolean).join(' ')||c.fio||c.clientName;
  const result=await deps.sendOne({chatId:event.chatId,
   ...(event.recipient==='student'?{parseMode:'HTML' as const,text:studentCompletionMessage}:
    {text:`🚨 НОВЫЙ LINKEDIN ГОТОВ — ЗАПУЩЕН НОВЫЙ ЦИКЛ\nКлиент: ${name}\nСтек: ${c.primaryStack||'не указан'}\nЗаявка №${event.taskId}: сделана экспертом\nНовый LinkedIn: ${event.url}\nLinkLab: Новый, прогресс 0%\n\n@juliafeels fyi`}),
   reportContext:{clientId:event.clientId,clientName:name,chatPurpose:event.recipient==='student'?'Общий чат ученика':'Ботоотчёты'}});
  if(result.kind==='telegram-response'){
   if(result.response.ok)await deps.store.finish(event,'sent',result.response.result.message_id);
   else await deps.store.finish(event,'failed',undefined,`telegram_${result.response.error_code}`);
  }else await deps.store.finish(event,['validation','configuration'].includes(result.failure.stage)?'failed':'uncertain',undefined,result.failure.stage);
 }catch{await deps.store.finish(event,'uncertain',undefined,'delivery_unknown');}
 return true;
}
const studentCompletionMessage='Привет! Твой LinkedIn готов! 🎉\n\nЛогин и пароль от LinkedIn и доступ к Octo — в личном кабинете, в разделе «LinkedIn».\n\nЧтобы аккаунт не забанили, пожалуйста:\n\n• <b>Первый месяц вообще не заходи в LinkedIn.</b> Аккаунт сейчас прогревает наша команда, и любой лишний вход может привести к бану.\n\n• Через месяц заходи в LinkedIn <b>ТОЛЬКО через Octo на компьютере</b>: не с телефона и не из обычного браузера.\n\n• Не включай двухфакторную аутентификацию и не меняй пароль.';
export function cycleNotificationRuntime(pass:()=>Promise<unknown>,report:(code:string)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined,running:Promise<unknown>|undefined,stopped=true;
 const tick=async()=>{if(stopped)return;running=pass().catch(()=>report('linkedin_cycle_notification_failed'));
  await running;running=undefined;if(!stopped)timer=setTimeout(tick,5000);};
 return{async start(){if(!stopped)return;stopped=false;await tick();},async stop(){stopped=true;if(timer)clearTimeout(timer);await running;}};
}
