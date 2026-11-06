import type {SendOneInput} from '../../../integrations/telegram/types.ts';
// Explicitly authorized by the user on 2026-11-06 after Telegram migrated the old test group.
export const localTestChat='-1003804004336';
export const localTestTopic=1;
export function routeLocalTestNotice(input:SendOneInput,clientIds:readonly number[]):SendOneInput{
  if(!clientIds.includes(Number(input.reportContext?.clientId)))return input;
  // General is topic 1. Telegram requires omitting message_thread_id for this topic.
  const {messageThreadId,...general}=input;
  return {...general,chatId:localTestChat};
}
