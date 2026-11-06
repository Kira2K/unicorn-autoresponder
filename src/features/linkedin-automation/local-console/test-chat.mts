import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import type {SqlPool,CopyDatabase} from '../../../integrations/postgres/contracts.mts';
import {assertFixture,fixtureEmail} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import {localTestChat} from './notification-target.mts';
export {localTestChat} from './notification-target.mts';
/** Explicit preparation only; never binds real students or a previously secured different chat. */
export function bindLocalTestChats(pool:SqlPool,database:CopyDatabase,runId:string){
  return writeTransaction(pool,database,async s=>{
    const ids:number[]=[];
    for(const kind of ['auto','manual'] as const){
      const row=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1 FOR UPDATE',[fixtureEmail(runId,kind)])).rows[0];assertFixture(row,runId,kind);
      if(row.secured_general_chat_id&&String(row.secured_general_chat_id)!==localTestChat)throw Error('e2e_secured_chat_mismatch');
      await s.query('UPDATE noco.clients SET telegram_general_chat_id=$2 WHERE id=$1',[row.id,localTestChat]);ids.push(Number(row.id));
    }
    return ids;
  });
}
