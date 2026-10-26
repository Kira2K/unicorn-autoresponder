import type {PollApi} from './runtime.mts';
import {updateInput} from './runtime.mts';
import type {Membership,Sender} from './types.mts';
import type {TestConfig} from './test-config.mts';
import {username} from './policy.mts';
import {groupJoin} from './group-welcome.mts';

type IdentityApi={getMe():Promise<unknown>;getChat(chatId:string):Promise<unknown>;
  getChatMember(chatId:string,userId:number):Promise<unknown>};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};

/** Read-only Telegram checks: no polling, command registration or messages. */
export async function verifyTestTelegram(api:IdentityApi,config:TestConfig):Promise<string>{
  const bot=record(await api.getMe());
  if(!Number.isSafeInteger(bot.id)||Number(bot.id)<=0||bot.is_bot!==true||
    username(String(bot.username??''))!==config.botUsername)throw new Error('mentor_test_bot_mismatch');
  const chat=record(await api.getChat('@'+config.chatUsername));
  if(!Number.isSafeInteger(chat.id)||Number(chat.id)>=0||!['group','supergroup'].includes(String(chat.type)))
    throw new Error('mentor_test_group_required');
  if(config.chatId&&String(chat.id)!==config.chatId)throw new Error('mentor_test_group_mismatch');
  const chatId=String(chat.id),member=record(await api.getChatMember(chatId,Number(bot.id)));
  if(record(member.user).id!==bot.id||!['creator','administrator'].includes(String(member.status)))
    throw new Error('mentor_test_bot_admin_required');
  if(config.reportChatId!==chatId){
    try{
      const report=record(await api.getChat(config.reportChatId));
      if(String(report.id)!==config.reportChatId)throw new Error('mentor_test_report_chat_mismatch');
      if(report.type!=='private'){
        const member=record(await api.getChatMember(config.reportChatId,Number(bot.id)));
        const admin=['creator','administrator'].includes(String(member.status));
        const present=admin||member.status==='member'||(member.status==='restricted'&&member.is_member===true);
        if(record(member.user).id!==bot.id||!present||
          (!admin&&(member.can_send_messages===false||record(report.permissions).can_send_messages===false))||
          (report.type==='channel'&&(!admin||member.can_post_messages===false)))
          throw new Error('mentor_test_report_permission_required');
      }
    }catch(cause){throw new Error('mentor_test_report_chat_unavailable',{cause});}
  }
  return chatId;
}

/** Keep offsets for ignored updates; optional SQL lookup admits this client's current mentors. */
export function scopeTestTransport(transport:{api:PollApi;member:Membership;send:Sender},config:TestConfig,chatId:string,
  additionalActor?:(actor:string)=>Promise<boolean>){
  const actors=new Set([config.studentUsername,...config.staffUsernames]);
  const destinations=new Set([chatId,config.reportChatId]);
  const api:PollApi={
    async getUpdates(...args){
      const accepted:unknown[]=[],dynamic=new Map<string,boolean>();
      for(const raw of await transport.api.getUpdates(...args)){
        if(groupJoin(raw,config.botUsername)?.chatId===chatId){accepted.push(raw);continue;}
        const parsed=updateInput(raw);
        if(parsed&&parsed.input.chatId===chatId){
          const actor=username(parsed.input.username);
          if(actor&&!actors.has(actor)&&additionalActor&&!dynamic.has(actor))dynamic.set(actor,await additionalActor(actor));
          if(actors.has(actor)||dynamic.get(actor)){accepted.push(raw);continue;}
        }
        accepted.push({update_id:record(raw).update_id});
      }
      return accepted;
    },
    answerCallbackQuery:input=>transport.api.answerCallbackQuery(input)
  };
  const send:Sender=async input=>destinations.has(input.chatId)?transport.send(input):{
    kind:'client-failure',failure:{stage:'validation',error:{name:'Error',message:'mentor_test_destination_denied'}}};
  const member:Membership=(chat,user)=>chat===chatId?transport.member(chat,user):Promise.resolve(false);
  return {api,send,member};
}
