import {randomUUID} from 'node:crypto';
import type {CopyDatabase,SqlPool} from '../../../integrations/postgres/contracts.mts';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {SendOneInput,SendOneResult} from '../../../integrations/telegram/types.ts';
import type {Move} from './contracts.mts';
import {destinations} from './contracts.mts';
export function moveNoticeStore(pool:SqlPool,database:CopyDatabase,clientIds?:number|readonly number[]) {
  const ids=typeof clientIds==='number'?[clientIds]:clientIds;
  return {
    claim:()=>writeTransaction(pool,database,async s=>{
      await s.query("UPDATE noco.linkedin_proxy_move SET notice_state='uncertain',error_code='claim_expired' WHERE notice_state='attempting' AND claimed_at<clock_timestamp()-interval '10 minutes' AND ($1::bigint[] IS NULL OR client_id=ANY($1))",[ids??null]);
      const row=(await s.query("SELECT m.data,c.client_role='фейк' AS is_test FROM noco.linkedin_proxy_move m JOIN noco.clients c ON c.id=m.client_id WHERE m.notice_state='pending' AND ($1::bigint[] IS NULL OR m.client_id=ANY($1)) ORDER BY m.id FOR UPDATE OF m SKIP LOCKED LIMIT 1",[ids??null])).rows[0];
      if(!row)return undefined;
      const move=row.data as Move,token:string=randomUUID();
      await s.query("UPDATE noco.linkedin_proxy_move SET notice_state='attempting',claim_token=$2,claimed_at=clock_timestamp() WHERE id=$1",[move.id,token]);
      return {move,token,test:row.is_test===true};
    }),
    finish:(id:string,token:string,state:'sent'|'failed'|'uncertain',messageId?:number)=>writeTransaction(pool,database,s=>s.query(
      "UPDATE noco.linkedin_proxy_move SET notice_state=$3,message_id=$4 WHERE id=$1 AND claim_token=$2 AND notice_state='attempting'",[id,token,state,messageId??null]))
  };
}
export async function deliverMoveNotice(deps:{store:ReturnType<typeof moveNoticeStore>;
  client(id:number):Promise<{firstName?:string;lastName?:string;fio?:string;primaryStack?:string;clientRole?:string}>;
  sendOne(input:SendOneInput):Promise<SendOneResult>;testChatId?:string}) {
  const claimed=await deps.store.claim();if(!claimed)return false;
  const {move,token}=claimed;
  try {
    const client=await deps.client(move.clientId),name=[client.firstName,client.lastName].filter(Boolean).join(' ')||client.fio||String(move.clientId);
    const result=await deps.sendOne({chatId:claimed.test?(deps.testChatId??'-5216637594'):'-1003187558078',
      text:`Ученик переехал: ${name}\nСтек: ${client.primaryStack||'не указан'}\nСтрана: ${destinations[move.country].country}\nДата: ${move.completedAt}\n\n@juliafeels fyi`,
      reportContext:{clientId:move.clientId,clientName:name,chatType:'supergroup',chatPurpose:'Переезд LinkedIn'}});
    if(result.kind==='telegram-response')await deps.store.finish(move.id,token,result.response.ok?'sent':'failed',result.response.ok?result.response.result.message_id:undefined);
    else await deps.store.finish(move.id,token,['configuration','validation'].includes(result.failure.stage)?'failed':'uncertain');
  } catch { await deps.store.finish(move.id,token,'uncertain'); }
  return true;
}
