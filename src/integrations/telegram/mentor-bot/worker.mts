import type { Client, Membership, Sender, Store } from './types.mts';
import type { PollApi, RuntimeLock } from './runtime.mts';
import {run} from './runtime.mts';
import {createMentorService} from './service.mts';
import {tick} from './schedule.mts';
import {deliver} from './delivery.mts';
import {createTelegramThrottle,FLOOD_METHODS} from './telegram-throttle.mts';
import type {Cooldowns} from './telegram-throttle.mts';
import {prepareGroupWelcome} from './group-welcome.mts';
/** Dependency-injected assembly. Importing this module never starts jobs. */
export function createMentorWorker(input:{
  store:Store;member:Membership;send:Sender;api:PollApi;lock:RuntimeLock;
  reportChatId:string;botUsername:string;now?:()=>number;log?:(event:Record<string,unknown>)=>void;
  staffAllowed?:(client:Client,actor:string)=>boolean;
}){
  if(!input.reportChatId.trim()||!input.botUsername.trim())throw new Error('mentor_configuration_required');
  const now=input.now??Date.now;
  const log=input.log??((event:Record<string,unknown>)=>console.info(JSON.stringify(event)));
  const transport=createTelegramThrottle({...input,now,onFlood:async(method,until)=>{
    try{await input.store.transaction(s=>{const key='telegram:cooldown:'+method;
      s.operations[key]={at:Math.max(s.operations[key]?.at??0,until)};});}
    catch{try{log({event:'mentor_cooldown_checkpoint_failed',method});}catch{}}
  }});
  const service=createMentorService({...input,member:transport.member,now,log});
  return {handle:service.handle,async start(signal:AbortSignal){
    try{
      const saved=await input.store.transaction(s=>Object.fromEntries(FLOOD_METHODS
        .map(method=>[method,s.operations['telegram:cooldown:'+method]?.at??0])) as Cooldowns);
      transport.restore(saved);
    }catch{try{log({event:'mentor_cooldown_restore_failed'});}catch{}}
    return run({...input,api:transport.api,send:transport.send,now,log,signal,handle:service.handle,
      handleGroupUpdate:update=>prepareGroupWelcome(input.store,update,input.botUsername,now()),
      maintenance:async()=>{
        let failed=false,failure:unknown;
        try{await tick(input.store,now(),input.reportChatId,log);}catch(error){failed=true;failure=error;}
        try{await deliver({store:input.store,send:transport.send,now,log});}catch(error){failed=true;failure??=error;}
        if(failed)throw failure;
      }});
  }};
}
