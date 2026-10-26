import type { Delivery, DeliveryScope, DeliveryState, Sender, Store } from './types.mts';
import {ACTIONS} from './types.mts';
import { checkinDelivery, CHECKIN_STATUSES, EXCLUDED } from './policy.mts';
import { renderDelivery } from './message-templates.mts';
import { retryDelayMs } from './failures.mts';
function relevant(s:DeliveryState,d:Delivery,now:number):boolean {
  if (d.expiresAt !== undefined && now >= d.expiresAt) return false;
  if (d.kind === 'feedback') return !d.clientId && !d.template;
  if (!d.clientId) return false;
  // Older releases queued this literal notice; retain its history without sending it after removal.
  if (d.kind === 'notice' && (d.template?.type === 'notice' ? d.template.text : d.input.text)
    .includes('Поздравляем с принятым оффером!')) return false;
  const c=s.clients[d.clientId],l=s.learners[d.clientId];
  if (!c || !l) return false;
  if (checkinDelivery(d,s.sessions) && (!CHECKIN_STATUSES.has(c.status)||!CHECKIN_STATUSES.has(l.status))) return false;
  const excluded=EXCLUDED.has(c.status)||EXCLUDED.has(l.status);
  if (excluded && (d.kind === 'report' || d.kind === 'reminder' ||
      (d.sessionId && s.sessions[d.sessionId]?.action === 'checkin'))) return false;
  if (l.syncError && d.sessionId) return false;
  if (d.id.startsWith('welcome:') && d.input.chatId !== c.chatId) return false;
  if (d.sessionId) {
    const session=s.sessions[d.sessionId];
    if (!session || !ACTIONS.includes(session.action) || session.revision !== d.sessionRevision || session.chatId !== c.chatId) return false;
  }
  if (d.relevance === 'pitch') return l.status === 'studying' && !l.ready && l.hardCompletedAt !== undefined &&
    (d.relevanceAt === undefined || l.readyAt === undefined || d.relevanceAt >= l.readyAt);
  if (d.relevance === 'checkin') {
    const ch=s.checkins[d.checkinId!];
    return l.active && !EXCLUDED.has(l.status) && !!ch && ch.state === 'open' && ch.closesAt > now && !ch.result;
  }
  return true;
}
/** One bounded batch; unknown sends may duplicate by explicit product decision. */
export async function deliver(options:{
  store:Store;send:Sender;now:()=>number;limit?:number;leaseMs?:number;
  log?:(event:{event:string;deliveryId:string;state:string;attempts:number;operation:'send'|'edit';chatId:string;messageId?:number})=>void;
}):Promise<number> {
  let processed=0;
  const transaction=<T,>(scope:DeliveryScope,operation:(state:DeliveryState)=>T):Promise<T>=>
    options.store.deliveryTransaction ? options.store.deliveryTransaction(scope,operation) : options.store.transaction(operation);
  for (let i=0;i<(options.limit ?? 50);i++) {
    const now=options.now();
    const scope={now,leaseMs:options.leaseMs ?? 120_000};
    const job=await transaction(scope,s=>{
      const pending=Object.values(s.deliveries).filter(d=>
        (d.state === 'pending' && d.retryAt <= now) ||
        (d.state === 'sending' && (d.claimedAt ?? 0)+(options.leaseMs ?? 120_000) <= now));
      for (const d of pending) {
        if (d.relevance && d.clientId && s.learners[d.clientId]?.syncError && (d.expiresAt === undefined || now < d.expiresAt) &&
            !EXCLUDED.has(s.clients[d.clientId]?.status??'') &&
            !(checkinDelivery(d,s.sessions)&&!CHECKIN_STATUSES.has(s.clients[d.clientId]?.status??''))) continue;
        if (!relevant(s,d,now)) { d.state='cancelled';continue; }
        const c=d.clientId?s.clients[d.clientId]:undefined;
        if (d.kind !== 'report' && d.kind !== 'feedback') d.input.chatId=c!.chatId;
        if (d.sessionId && s.sessions[d.sessionId].messageId)
          d.input.editMessageId=s.sessions[d.sessionId].messageId;
        try{d.input=renderDelivery(s,d);}catch{
          d.state='blocked';d.error='render_failed';continue;
        }
        d.state='sending';d.claimedAt=now;d.attempts++;
        return structuredClone(d);
      }
      return null;
    });
    if (!job) break;
    let disposition:'sent'|'pending'|'blocked'='pending',code='uncertain',messageId:number|undefined,retryMs=0;
    try {
      const result=await options.send(job.input);
      if (result.kind === 'telegram-response') {
        if (result.response.ok) {disposition='sent';messageId=result.response.result.message_id;code='ok';}
        else {
          const error=result.response;
          code='telegram_' + error.error_code;
          if (job.input.editMessageId && error.error_code === 400 && /message is not modified/i.test(error.description)) {
            disposition='sent';messageId=job.input.editMessageId;code='ok';
          } else {
            disposition=error.error_code === 429 || error.error_code >= 500 ? 'pending' : 'blocked';
            retryMs=retryDelayMs(error) ?? 0;
          }
        }
      } else {
        code=result.failure.stage;
        disposition=['validation','configuration'].includes(code) ? 'blocked' : 'pending';
      }
    } catch (error) {retryMs=retryDelayMs(error)??0;code=retryMs?'flood_wait':'uncertain';}
    await transaction({...scope,deliveryId:job.id},s=>{
      const d=s.deliveries[job.id];
      if (!d || d.state !== 'sending' || d.attempts !== job.attempts) return;
      d.state=disposition;d.error=code;d.messageId=messageId;
      d.retryAt=options.now()+(retryMs||Math.min(300_000,1000*2**Math.min(d.attempts,9)));
      if (disposition === 'sent' && d.sessionId && s.sessions[d.sessionId]?.revision === d.sessionRevision)
        s.sessions[d.sessionId].messageId=messageId;
    });
    try {options.log?.({event:'mentor_delivery',deliveryId:job.id,state:disposition,attempts:job.attempts,
      operation:job.input.editMessageId?'edit':'send',chatId:job.input.chatId,messageId});} catch {}
    processed++;
  }
  return processed;
}
