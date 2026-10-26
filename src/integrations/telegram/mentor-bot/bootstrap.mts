import type { Store } from './types.mts';
import { enqueue, homeMarkup } from './messages.mts';
/** Enqueue once for explicitly enrolled groups. No Telegram calls here. */
export async function prepareWelcome(store:Store,now:number):Promise<void>{
  await store.transaction(s=>{
    for(const l of Object.values(s.learners)){
      const c=s.clients[l.clientId];if(!c)continue;
      enqueue(s,{id:'welcome:'+c.id+':'+c.chatId,clientId:c.id,kind:'notice',template:{type:'welcome'},input:{
        chatId:c.chatId,text:'',
        replyMarkup:homeMarkup}},now);
    }
  });
}
export async function pinWelcomes(store:Store,pin:(chatId:string,messageId:number)=>Promise<unknown>):Promise<void>{
  const jobs=await store.transaction(s=>Object.values(s.deliveries).filter(d=>d.id.startsWith('welcome:')&&d.state==='sent'&&
    d.messageId&&!s.operations['pin:'+d.id]&&d.clientId&&s.clients[d.clientId]?.chatId===d.input.chatId));
  for(const d of jobs){
    await pin(d.input.chatId,d.messageId!);
    await store.transaction(s=>{s.operations['pin:'+d.id]={at:Date.now()};});
  }
}
