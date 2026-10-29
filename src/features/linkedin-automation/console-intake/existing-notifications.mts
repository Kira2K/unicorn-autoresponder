import {randomUUID} from 'node:crypto';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';
import type {WebClient} from '../../web-console/backend/types.ts';
import {DEFAULT_NOTIFICATION_MENTION} from '../creation-tasks/status-report.mts';
export interface ExistingLinkedInNotice{accountId:number;clientId:number;url:string;token:string}
export function existingNotificationStore(pool:SqlPool,database:CopyDatabase){return{
 claim:():Promise<ExistingLinkedInNotice|undefined>=>writeTransaction(pool,database,async s=>{
  await s.query("UPDATE noco.linkedin_intake_notifications SET state='uncertain',error_code='claim_expired' WHERE state='attempting' AND claimed_at<clock_timestamp()-interval '10 minutes'");
  const row=(await s.query(`SELECT n.account_id,n.client_id,a.url FROM noco.linkedin_intake_notifications n
   JOIN noco.platform_accounts a ON a.id=n.account_id AND a.clients_id=n.client_id
   WHERE n.state='pending' AND NOT coalesce(a.__nc_deleted,false) AND NOT coalesce(a.is_banned,false)
   ORDER BY n.account_id FOR UPDATE OF n SKIP LOCKED LIMIT 1`)).rows[0];
  if(!row)return undefined;const token=randomUUID();
  await s.query("UPDATE noco.linkedin_intake_notifications SET state='attempting',claim_token=$2,claimed_at=clock_timestamp() WHERE account_id=$1",[row.account_id,token]);
  return{accountId:Number(row.account_id),clientId:Number(row.client_id),url:String(row.url),token};
 }),
 finish:(event:ExistingLinkedInNotice,state:'sent'|'failed'|'uncertain',messageId?:number,code?:string)=>writeTransaction(pool,database,
  s=>s.query("UPDATE noco.linkedin_intake_notifications SET state=$3,message_id=$4,error_code=$5 WHERE account_id=$1 AND claim_token=$2 AND state='attempting'",[event.accountId,event.token,state,messageId??null,code??null]))
};}
export async function deliverExistingNotification(deps:{store:ReturnType<typeof existingNotificationStore>;mention?:string;
 client(id:number):Promise<Pick<WebClient,'firstName'|'lastName'|'fio'|'clientName'|'primaryStack'>>;sendOne(input:SendOneInput):Promise<SendOneResult>}){
 const event=await deps.store.claim();if(!event)return false;
 try{
  const c=await deps.client(event.clientId),name=[c.firstName,c.lastName].filter(Boolean).join(' ')||c.fio||c.clientName;
  const result=await deps.sendOne({chatId:'-1003187558078',text:`Ученик подключил существующий LinkedIn\nКлиент: ${name}\nСтек: ${c.primaryStack||'не указан'}\nLinkedIn: ${event.url}\n\n${deps.mention??DEFAULT_NOTIFICATION_MENTION} fyi`,
   reportContext:{clientId:event.clientId,clientName:name,chatType:'supergroup',chatPurpose:'Существующий LinkedIn'}});
  if(result.kind==='telegram-response'){
   if(result.response.ok)await deps.store.finish(event,'sent',result.response.result.message_id);
   else await deps.store.finish(event,'failed',undefined,`telegram_${result.response.error_code}`);
  }else await deps.store.finish(event,['validation','configuration'].includes(result.failure.stage)?'failed':'uncertain',undefined,result.failure.stage);
 }catch{await deps.store.finish(event,'uncertain',undefined,'delivery_unknown');}
 return true;
}
