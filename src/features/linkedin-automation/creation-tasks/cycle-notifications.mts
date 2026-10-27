import {randomUUID} from 'node:crypto';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';
import type {WebClient} from '../../web-console/backend/types.ts';
export interface CycleNotice{taskId:number;clientId:number;url:string;token:string}
export function cycleNotificationStore(pool:SqlPool,database:CopyDatabase){
 return{
  claim:():Promise<CycleNotice|undefined>=>writeTransaction(pool,database,async s=>{
   await s.query("UPDATE noco.linkedin_cycle_notifications SET state='uncertain',error_code='claim_expired' WHERE state='attempting' AND claimed_at<clock_timestamp()-interval '10 minutes'");
   const row=(await s.query("SELECT task_id,client_id,url FROM noco.linkedin_cycle_notifications WHERE state='pending' ORDER BY task_id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];
   if(!row)return undefined;const token=randomUUID();
   await s.query("UPDATE noco.linkedin_cycle_notifications SET state='attempting',claim_token=$2,claimed_at=clock_timestamp() WHERE task_id=$1",[row.task_id,token]);
   return{taskId:Number(row.task_id),clientId:Number(row.client_id),url:String(row.url),token};
  }),
  finish:(event:CycleNotice,state:'sent'|'failed'|'uncertain',messageId?:number,code?:string)=>writeTransaction(pool,database,
   s=>s.query("UPDATE noco.linkedin_cycle_notifications SET state=$3,message_id=$4,error_code=$5 WHERE task_id=$1 AND claim_token=$2 AND state='attempting'",[event.taskId,event.token,state,messageId??null,code??null]))
 };
}
/** One claimed event, one send attempt. Business confirmation is already committed. */
export async function deliverCycleNotification(deps:{store:ReturnType<typeof cycleNotificationStore>;
 client(id:number):Promise<Pick<WebClient,'firstName'|'lastName'|'fio'|'clientName'|'primaryStack'>>;
 sendOne(input:SendOneInput):Promise<SendOneResult>}){
 const event=await deps.store.claim();if(!event)return false;
 try{
  const c=await deps.client(event.clientId),name=[c.firstName,c.lastName].filter(Boolean).join(' ')||c.fio||c.clientName;
  const result=await deps.sendOne({chatId:'-1003187558078',
   text:`🚨 НОВЫЙ LINKEDIN — ЗАПУЩЕН НОВЫЙ ЦИКЛ\nКлиент: ${name}\nСтек: ${c.primaryStack||'не указан'}\nЗаявка №${event.taskId}: выполнение подтверждено\nНовый LinkedIn: ${event.url}\nLinkLab: Новый, прогресс 0%\n\n@juliafeels fyi`,
   reportContext:{clientId:event.clientId,clientName:name,chatType:'supergroup',chatPurpose:'Новый цикл LinkedIn'}});
  if(result.kind==='telegram-response'){
   if(result.response.ok)await deps.store.finish(event,'sent',result.response.result.message_id);
   else await deps.store.finish(event,'failed',undefined,`telegram_${result.response.error_code}`);
  }else await deps.store.finish(event,['validation','configuration'].includes(result.failure.stage)?'failed':'uncertain',undefined,result.failure.stage);
 }catch{await deps.store.finish(event,'uncertain',undefined,'delivery_unknown');}
 return true;
}
export function cycleNotificationRuntime(pass:()=>Promise<unknown>,report:(code:string)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined,running:Promise<unknown>|undefined,stopped=true;
 const tick=async()=>{if(stopped)return;running=pass().catch(()=>report('linkedin_cycle_notification_failed'));
  await running;running=undefined;if(!stopped)timer=setTimeout(tick,5000);};
 return{async start(){if(!stopped)return;stopped=false;await tick();},async stop(){stopped=true;if(timer)clearTimeout(timer);await running;}};
}
