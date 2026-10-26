import type {Update} from '@grammyjs/types';
import type {Store} from './types.mts';
import {enqueue,homeMarkup} from './messages.mts';
import {username} from './policy.mts';

/** Only the bot's own absent-to-present membership transition is a group addition. */
export function groupJoin(value:unknown,botUsername:string):{updateId:number;chatId:string}|null {
  if(!value||typeof value!=='object')return null;
  const update=value as Update,member=update.my_chat_member;
  if(!Number.isSafeInteger(update.update_id)||update.update_id<0||!member||
    !Number.isSafeInteger(member.chat?.id)||member.chat.id>=0||!['group','supergroup'].includes(member.chat.type)||
    !['left','kicked'].includes(member.old_chat_member?.status)||
    !['member','administrator'].includes(member.new_chat_member?.status))return null;
  const bot=member.new_chat_member.user;
  if(!bot||!Number.isSafeInteger(bot.id)||bot.id<=0||bot.is_bot!==true||
    member.old_chat_member.user?.id!==bot.id||!username(botUsername)||
    username(bot.username??'')!==username(botUsername))return null;
  return {updateId:update.update_id,chatId:String(member.chat.id)};
}

/** Queue once per addition, with a durable receipt; never change enrollment or client progress. */
export async function prepareGroupWelcome(store:Store,update:unknown,botUsername:string,now:number):Promise<void>{
  const joined=groupJoin(update,botUsername);if(!joined)return;
  await store.transaction(s=>{
    const key='welcome:update:'+joined.updateId;
    if(s.operations[key])return;
    const clients=Object.values(s.clients).filter(c=>c.chatId===joined.chatId&&s.learners[c.id]);
    if(clients.length!==1)return;
    const c=clients[0];
    enqueue(s,{id:'welcome:'+c.id+':'+c.chatId+':'+joined.updateId,clientId:c.id,kind:'notice',
      template:{type:'welcome'},input:{chatId:c.chatId,text:'',replyMarkup:homeMarkup}},now);
    s.operations[key]={at:now};
  });
}
