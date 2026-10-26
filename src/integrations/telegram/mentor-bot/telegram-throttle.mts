import type { Membership, Sender } from './types.mts';
import type { PollApi } from './runtime.mts';
import { retryDelayMs } from './failures.mts';

export type FloodMethod = 'send' | 'poll' | 'member' | 'callback';
export type Cooldowns = Partial<Record<FloodMethod,number>>;
export const FLOOD_METHODS: FloodMethod[]=['send','poll','member','callback'];
function deferred(ms:number):Error {
  return Object.assign(new Error('mentor_flood_wait'),{code:'mentor_flood_wait',retryAfterMs:ms});
}

/** No sleeps or business retries. All outgoing sends/edits share one budget and server cooldown. */
export function createTelegramThrottle(options:{
  now:()=>number;send:Sender;member:Membership;api:PollApi;
  onFlood?:(method:FloodMethod,until:number)=>Promise<void>;
}) {
  const cooldowns:Cooldowns={};
  let globalSends:number[]=[];
  const chatSends=new Map<string,number[]>();
  async function observe(method:FloodMethod,value:unknown):Promise<void>{
    const delay=retryDelayMs(value);if(delay===undefined)return;
    const until=Math.min(Number.MAX_SAFE_INTEGER,options.now()+delay);
    cooldowns[method]=Math.max(cooldowns[method]??0,until);
    try{await options.onFlood?.(method,cooldowns[method]!);}catch{} // Storage failure cannot erase the in-memory gate or the original result.
  }
  function check(method:FloodMethod,chatId?:string):void{
    const now=options.now();let until=cooldowns[method]??0;
    if(method==='send'&&chatId!==undefined){
      globalSends=globalSends.filter(at=>at>now-1000);
      const chat=(chatSends.get(chatId)??[]).filter(at=>at>now-60_000);
      chatSends.set(chatId,chat);
      if(globalSends.length>=25)until=Math.max(until,globalSends[0]+1000);
      if(chat.length)until=Math.max(until,chat.at(-1)!+1000);
      if(chatId.startsWith('-')&&chat.length>=20)until=Math.max(until,chat[chat.length-20]+60_000);
      if(until<=now){globalSends.push(now);chat.push(now);}
    }
    if(until>now)throw deferred(until-now);
  }
  async function request<T>(method:FloodMethod,operation:()=>Promise<T>,chatId?:string):Promise<T>{
    check(method,chatId);
    try{return await operation();}catch(error){await observe(method,error);throw error;}
  }
  const send:Sender=input=>request('send',async()=>{
    const result=await options.send(input);
    if(result.kind==='telegram-response'&&!result.response.ok)await observe('send',result.response);
    return result;
  },input.chatId);
  return {send,member:((chatId,userId)=>request('member',()=>options.member(chatId,userId))) as Membership,
    api:{
      getUpdates:(...args:Parameters<PollApi['getUpdates']>)=>request('poll',()=>options.api.getUpdates(...args)),
      answerCallbackQuery:(input:Parameters<PollApi['answerCallbackQuery']>[0])=>request('callback',()=>options.api.answerCallbackQuery(input))
    } satisfies PollApi,
    restore(values:Cooldowns){for(const key of FLOOD_METHODS){const at=values[key];
      if(typeof at==='number'&&Number.isSafeInteger(at))cooldowns[key]=Math.max(cooldowns[key]??0,at);}}
  };
}
