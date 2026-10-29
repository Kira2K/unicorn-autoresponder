import type { SendOneInput, SendOneResult } from '../../../integrations/telegram/types.ts';
import type { WebClient } from '../../web-console/backend/types.ts';
import type { TaskStatus } from './contracts.mts';

export interface TaskStatusChange {
  taskId:number; clientId:number; from:TaskStatus; to:TaskStatus;
}
export type StatusNotification = { outcome:'sent'; messageId:number } |
  { outcome:'failed'|'uncertain'; code:string };
export const DEFAULT_NOTIFICATION_MENTION = '@juliafeels';

/** One post-commit notification attempt. The status transition is never retried here. */
export function createTaskStatusReporter(deps: {
  chatId:string; mention?:string;
  client(id:number):Promise<Pick<WebClient,'firstName'|'lastName'|'fio'|'clientName'|'primaryStack'>>;
  sendOne(input:SendOneInput):Promise<SendOneResult>;
}) {
  const mention=deps.mention??DEFAULT_NOTIFICATION_MENTION;
  return async (change:TaskStatusChange):Promise<StatusNotification> => {
    let client;
    try { client=await deps.client(change.clientId); }
    catch { return {outcome:'failed',code:'client_lookup_failed'}; }
    const name=([client.firstName,client.lastName].filter(Boolean).join(' ') || client.fio || client.clientName).replace(/\s+/g,' ').trim();
    if(!name)return{outcome:'failed',code:'client_name_required'};
    const stack=client.primaryStack?.replace(/\s+/g,' ').trim() || 'не указан';
    try {
      const result=await deps.sendOne({chatId:deps.chatId,
        text:`Заявка на создание LinkedIn №${change.taskId}\nКлиент: ${name}\nСтек: ${stack}\nДенис изменил статус: «${change.from}» → «${change.to}».\n\n${mention} fyi`,
        reportContext:{clientId:change.clientId,clientName:name,chatPurpose:'Уведомления о заявках LinkedIn',chatType:'supergroup'}});
      if(result.kind==='client-failure')return{
        outcome:['validation','configuration'].includes(result.failure.stage)?'failed':'uncertain',code:result.failure.stage};
      return result.response.ok ? {outcome:'sent',messageId:result.response.result.message_id}
        : {outcome:'failed',code:`telegram_${result.response.error_code}`};
    } catch { return {outcome:'uncertain',code:'notification_internal'}; }
  };
}
