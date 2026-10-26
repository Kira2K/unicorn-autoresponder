import { memoryStore } from './memory-store.mts';
import { emptyState } from './types.mts';
import type { Client, Sender } from './types.mts';
import { fixtureClient, START } from './test-fixtures.mts';
import { enroll } from './schedule.mts';
import { createMentorService } from './service.mts';
import { deliver } from './delivery.mts';
export function harness(clients:Client[]=[fixtureClient()]){
  const initial=emptyState(clients);for(const c of clients)enroll(initial,c.id,START);
  const store=memoryStore(initial);
  let now=START,update=0,nextId=0,nextMessage=100;
  const sent:Parameters<Sender>[0][]=[];
  const sender:Sender=async input=>{
    sent.push(structuredClone(input));
    return {kind:'telegram-response',response:{ok:true,result:{message_id:input.editMessageId??++nextMessage,date:1,
      chat:{id:Number(input.chatId),type:'group',title:'Synthetic group'},text:input.text}}};
  };
  const service=createMentorService({store,member:async()=>true,reportChatId:'-900',now:()=>now,id:()=>String(++nextId),botUsername:'mentor_test_bot'});
  const flush=()=>deliver({store,send:sender,now:()=>now});
  const session=(actor='alice')=>Object.values(store.snapshot().sessions).filter(s=>s.owner===actor).at(-1)!;
  return {store,sent,service,flush,session,sender,now:()=>now,setNow:(at:number)=>{now=at;},
    async command(text:string,actor='alice'){
      const result=await service.handle({username:actor,userId:actor==='alice'?1:2,chatId:'-100',updateId:++update,text});
      await flush();return result;
    },
    async click(action:string,actor='alice'){
      const s=session(actor);
      const result=await service.handle({username:actor,userId:actor==='alice'?1:2,chatId:'-100',updateId:++update,
        messageId:s.messageId,callback:'m:'+s.id+':'+s.revision+':'+action});
      await flush();return result;
    }
  };
}
