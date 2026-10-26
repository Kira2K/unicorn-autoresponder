import type { Update } from '@grammyjs/types';
import type { Input, Outcome, Sender, Store } from './types.mts';
import { commitUncertain, configurationFailure, retryDelayMs, storageFailureCode, telegramErrorCode } from './failures.mts';
import { ERROR_TEXTS } from './error-texts.mts';
import { addressStudent, enqueue, homeMarkup } from './messages.mts';
export const MENTOR_ALLOWED_UPDATES = ['message','callback_query','my_chat_member'];
export interface PollApi {
  getUpdates(offset?:number,timeout?:number,allowedUpdates?:string[]):Promise<unknown[]>;
  answerCallbackQuery(input:{callbackQueryId:string;text?:string}):Promise<unknown>;
}
export interface RuntimeLock { acquire():Promise<boolean>; assertHeld():Promise<void>; release():Promise<void> }
export function updateInput(value:unknown):{input:Input;callbackId?:string}|null {
  if (!value || typeof value !== 'object') return null;
  const u=value as Update,callback='callback_query' in u ? u.callback_query : undefined;
  const message=callback?.message ?? ('message' in u ? u.message : undefined);
  const from=callback?.from ?? (message && 'from' in message ? message.from : undefined);
  if (!Number.isSafeInteger(u.update_id) || !message || typeof message !== 'object' || !message.chat ||
    !Number.isSafeInteger(message.chat.id) || !Number.isSafeInteger(message.message_id) ||
    !from || !Number.isSafeInteger(from.id) || from.is_bot || typeof from.username !== 'string' || !from.username ||
    !['group','supergroup'].includes(message.chat.type) || ('sender_chat' in message && message.sender_chat)) return null;
  return {input:{updateId:u.update_id,username:from.username,userId:from.id,chatId:String(message.chat.id),
    messageId:message.message_id,...(callback ? {callback:callback.data} :
      'text' in message ? {text:message.text} : {})},...(callback ? {callbackId:callback.id} : {})};
}
export async function run(options:{
  store:Store;api:PollApi;lock:RuntimeLock;send:Sender;handle:(input:Input)=>Promise<Outcome>;
  handleGroupUpdate?:(update:unknown)=>Promise<void>;
  maintenance:()=>Promise<void>;signal:AbortSignal;wait?:(ms:number,signal:AbortSignal)=>Promise<void>;
  now?:()=>number;reportChatId?:string;
  log?:(event:{event:string;code:string;reason?:string})=>void;
}):Promise<void> {
  if (!await options.lock.acquire()) throw new Error('mentor_worker_already_running');
  const wait=options.wait ?? ((ms,signal)=>new Promise<void>(resolve=>{
    if(signal.aborted){resolve();return;}
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
  }));
  const log=(code:string,reason:string)=>{try{options.log?.({event:'mentor_runtime',code,reason});}catch{}};
  const now=options.now??Date.now;
  // Offset progresses in memory even while its checkpoint is unavailable. Receipts still protect committed actions.
  let offset=0,persistedOffset=0,cursorLoaded=false;
  const backgroundIncidents=new Set<'maintenance'|'cursor'>();
  async function feedback(id:string,chatId:string,text:string,home=true):Promise<void>{
    const input={chatId,text,...(home?{replyMarkup:homeMarkup}:{})};
    let delay=0;
    try{
      const sent=await options.send(input);
      if(sent.kind==='telegram-response'){
        if(sent.response.ok)return;
        if(sent.response.error_code!==429&&sent.response.error_code<500){log('feedback_failed','telegram_'+sent.response.error_code);return;}
        delay=retryDelayMs(sent.response)??2000;
      }else{
        log('feedback_failed',sent.failure.stage);
        if(['configuration','validation'].includes(sent.failure.stage))return;
        delay=2000;
      }
    }catch(error){delay=retryDelayMs(error)??2000;}
    try{
      await options.store.transaction(s=>{
        enqueue(s,{id,kind:'feedback',input},now());
        const d=s.deliveries[id];if(d.state==='pending')d.retryAt=Math.max(d.retryAt,now()+delay);
      });
    }catch{log('feedback_failed','storage_unavailable');}
  }
  async function backgroundFailure(error:unknown,source:'maintenance'|'cursor'):Promise<void>{
    log('background_failed',storageFailureCode(error));
    if(!backgroundIncidents.has(source)&&options.reportChatId){
      backgroundIncidents.add(source);
      await feedback('background:'+source+':'+now(),options.reportChatId,ERROR_TEXTS.backgroundFailed,false);
    }
  }
  try {
    while (!options.signal.aborted) {
      await options.lock.assertHeld();
      try {
        try{await options.maintenance();backgroundIncidents.delete('maintenance');}catch(error){
          if(configurationFailure(error))throw error;
          await backgroundFailure(error,'maintenance');
        }
        if(!cursorLoaded){
          try{
            persistedOffset=options.store.cursor?await options.store.cursor.read():await options.store.transaction(s=>s.offset);
            offset=Math.max(offset,persistedOffset);cursorLoaded=true;backgroundIncidents.delete('cursor');
          }catch(error){await backgroundFailure(error,'cursor');}
        }
        if(offset>persistedOffset){
          try{
            if(options.store.cursor)await options.store.cursor.advance(offset);
            else await options.store.transaction(s=>{s.offset=Math.max(s.offset,offset);});
            persistedOffset=offset;backgroundIncidents.delete('cursor');
          }catch(error){await backgroundFailure(error,'cursor');}
        }
        // One second keeps queue delivery responsive without sleeping on a busy destination.
        const updates=await options.api.getUpdates(offset || undefined,1,MENTOR_ALLOWED_UPDATES);
        for (const raw of updates) {
          if (options.signal.aborted) break;
          const update=raw as {update_id?:unknown};
          if (!Number.isSafeInteger(update?.update_id) || Number(update.update_id) < 0){log('invalid_update','shape');continue;}
          if(Number(update.update_id)<offset)continue;
          // Persist the welcome and its receipt before advancing the polling cursor.
          await options.handleGroupUpdate?.(raw);
          const parsed=updateInput(raw);
          const callbackId=(raw as Update).callback_query?.id;
          // Acknowledge receipt before membership, storage or business processing. This is not a success message.
          if(typeof callbackId==='string' && callbackId)
            await options.api.answerCallbackQuery({callbackQueryId:callbackId}).catch(()=>{log('callback_ack_failed','telegram');});
          let result:Outcome={code:'invalid'};
          try{if(parsed)result=await options.handle(parsed.input);}catch(error){
            if(configurationFailure(error))throw error;
            log('update_failed',storageFailureCode(error));
            result={code:'unavailable',error:commitUncertain(error)?'saveUncertain':'accessUnavailable'};
          }
          if(parsed&&result.code==='unavailable'&&!result.error)result.error='accessUnavailable';
          if(parsed&&result.error)await feedback('feedback:'+parsed.input.updateId+':'+result.error,
            parsed.input.chatId,addressStudent(ERROR_TEXTS[result.error],{username:parsed.input.username}));
          // Failed actions are reported and skipped, never silently replayed ahead of other chats.
          offset=Math.max(offset,Number(update.update_id)+1);
          try{
            if(options.store.cursor)await options.store.cursor.advance(offset);
            else await options.store.transaction(s=>{s.offset=Math.max(s.offset,offset);});
            persistedOffset=offset;backgroundIncidents.delete('cursor');
          }catch(error){await backgroundFailure(error,'cursor');}
        }
      } catch (error) {
        if (configurationFailure(error))
          throw new Error('mentor_poll_configuration_failed');
        const apiCode=telegramErrorCode(error);
        log('pass_failed',apiCode===undefined?storageFailureCode(error):'telegram_'+apiCode);
        if(!options.signal.aborted) await wait(retryDelayMs(error)??5000,options.signal);
      }
    }
  } finally {await options.lock.release();}
}
export function memoryLock():RuntimeLock {
  let locked=false;
  return {async acquire(){if(locked)return false;locked=true;return true;},async assertHeld(){if(!locked)throw new Error('mentor_worker_lock_lost');},async release(){locked=false;}};
}
