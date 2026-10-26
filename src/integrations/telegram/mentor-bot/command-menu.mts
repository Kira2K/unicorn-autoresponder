import type {BotCommand, BotCommandScope} from '@grammyjs/types';

export const MENTOR_MENU_COMMANDS:readonly BotCommand[]=[
  {command:'menu',description:'Главное меню'},
  {command:'what_my_stage',description:'Текущий этап ученика'},
  {command:'ready_pitch',description:'Готовность к самопрезентации'}
];

/** Telegram metadata only: no messages, polling, business actions, or global bot configuration. */
export async function configureMentorCommands(api:{
  setMyCommands(input:{commands:readonly BotCommand[];scope:BotCommandScope;languageCode?:string}):Promise<boolean>;
},chatId:string):Promise<void>{
  if(!/^-[1-9]\d*$/.test(chatId)||!Number.isSafeInteger(Number(chatId)))throw new Error('mentor_commands_group_required');
  for(const languageCode of ['','ru']){
    const ok=await api.setMyCommands({scope:{type:'chat',chat_id:chatId},languageCode,
      commands:MENTOR_MENU_COMMANDS.map(command=>({...command}))});
    if(ok!==true)throw new Error('mentor_commands_setup_failed');
  }
}
