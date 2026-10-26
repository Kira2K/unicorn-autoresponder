import { createRequire } from 'node:module';
import type { ChatMember } from '@grammyjs/types';
import type { Membership } from './types.mts';
const require=createRequire(import.meta.url);
const {createTelegramIntegration}=require('../integration.ts') as typeof import('../integration.ts');
const {createTelegramBotApi}=require('../bot-api.ts') as typeof import('../bot-api.ts');
/** Explicit credentials AND requester. No ENV lookup or implicit global fetch. */
export function mentorTelegram(options:{
  token:string;requester:NonNullable<Parameters<typeof createTelegramBotApi>[0]>['requester'];
}) {
  if(!options.token.trim() || !options.requester) throw new Error('mentor_explicit_transport_required');
  const api=createTelegramBotApi({token:options.token,requester:options.requester,requestTimeoutMs:45_000});
  const integration=createTelegramIntegration({token:options.token,botApi:api,env:{},
    regularErrorChatId:'',summaryLogsChatId:'',logger(){}});
  const member:Membership=async(chatId,userId)=>{
    const result=await api.getChatMember(chatId,userId) as ChatMember;
    if(!result || typeof result !== 'object' || !result.user || result.user.id !== userId)
      throw new Error('mentor_membership_response_invalid');
    return result.status === 'creator' || result.status === 'administrator' || result.status === 'member' ||
      (result.status === 'restricted' && result.is_member);
  };
  return {api,member,send:integration.sendOne,commands:integration.commands};
}
