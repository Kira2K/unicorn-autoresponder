import {createTelegramBotApi} from '../../../../integrations/telegram/bot-api.ts';
import {E2E_STUDENT_CHAT_ID} from './contracts.mts';
type Reader=Pick<ReturnType<typeof createTelegramBotApi>,'getMeResponse'|'getChatResponse'|'getChatMemberResponse'>;
function record(value:unknown):value is Record<string,any>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function result(value:unknown){if(!record(value)||value.ok!==true||!record(value.result))throw Error('e2e_test_chat_read_failed');return value.result;}
/** Read-only preflight. Denied/unknown destination blocks fixture creation; never sends a probe. */
export async function verifyTestChat(env:Record<string,string|undefined>,api:Reader=createTelegramBotApi({env})){
 try{
  const bot=result(await api.getMeResponse());
  if(bot.is_bot!==true||!Number.isSafeInteger(bot.id)||bot.id<=0)throw Error('e2e_test_chat_identity_invalid');
  const chat=result(await api.getChatResponse(E2E_STUDENT_CHAT_ID));
  if(String(chat.id)!==E2E_STUDENT_CHAT_ID||!['group','supergroup'].includes(chat.type))throw Error('e2e_test_chat_identity_invalid');
  const member=result(await api.getChatMemberResponse(E2E_STUDENT_CHAT_ID,bot.id));
  if(member.user?.id!==bot.id)throw Error('e2e_test_chat_identity_invalid');
  const writable=['creator','administrator'].includes(member.status)||member.status==='member'&&chat.permissions?.can_send_messages===true||member.status==='restricted'&&member.is_member===true&&member.can_send_messages===true;
  if(!writable)throw Error('e2e_test_chat_not_writable');
  return{chatId:E2E_STUDENT_CHAT_ID,botId:bot.id,chatType:chat.type,botStatus:member.status,canSendMessages:true};
 }catch(e){const code=e instanceof Error?e.message:'';throw Error(/^e2e_test_chat_[a-z_]+$/.test(code)?code:'e2e_test_chat_read_failed');}
}
