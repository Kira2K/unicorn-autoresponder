import {username} from './policy.mts';

export type TestConfig={token:string;botUsername:string;chatUsername:string;chatId?:string;reportChatId:string;clientId:string;
  studentUsername:string;adminUsername:string;hardMentorUsername:string;softMentorUsername:string;staffUsernames:string[]};

/** Parse only explicitly supplied test settings. Never fall back to support-bot credentials. */
export function readTestConfig(env:Readonly<Record<string,string|undefined>>):TestConfig{
  const token=env.MENTOR_BOT_API_KEY?.trim();
  if(!token)throw new Error('mentor_test_token_required');
  if(token===env.VEU_SUPPORT_BOT?.trim())throw new Error('mentor_test_separate_token_required');
  function tag(key:string,optional=false){
    const raw=env[key]?.trim()??'',value=username(raw);
    if(!value&&(!optional||raw))throw new Error('mentor_test_username_invalid:'+key);
    return value;
  }
  const botUsername=tag('MENTOR_BOT_USERNAME'),chatUsername=tag('MENTOR_BOT_TEST_CHAT_USERNAME');
  const studentUsername=tag('MENTOR_BOT_TEST_STUDENT_USERNAME'),adminUsername=tag('MENTOR_BOT_TEST_ADMIN_USERNAME');
  const hardMentorUsername=tag('MENTOR_BOT_TEST_HARD_MENTOR_USERNAME',true);
  const softMentorUsername=tag('MENTOR_BOT_TEST_SOFT_MENTOR_USERNAME',true);
  const supportUsername=tag('MENTOR_BOT_TEST_SUPPORT_USERNAME',true);
  const staffUsernames=[...new Set([adminUsername,hardMentorUsername,softMentorUsername,supportUsername].filter(Boolean))];
  if(staffUsernames.includes(studentUsername)||staffUsernames.includes(botUsername)||studentUsername===botUsername)
    throw new Error('mentor_test_role_conflict');
  const clientId=env.MENTOR_BOT_TEST_CLIENT_ID?.trim()??'',reportChatId=env.MENTOR_BOT_REPORT_CHAT_ID?.trim()??'';
  const chatId=env.MENTOR_BOT_TEST_CHAT_ID?.trim();
  if(chatId&&(!/^-[1-9]\d*$/.test(chatId)||!Number.isSafeInteger(Number(chatId))))throw new Error('mentor_test_group_id_invalid');
  if(!/^[1-9]\d*$/.test(clientId)||!Number.isSafeInteger(Number(clientId)))throw new Error('mentor_test_client_required');
  if(!/^-?[1-9]\d*$/.test(reportChatId)||!Number.isSafeInteger(Number(reportChatId)))throw new Error('mentor_test_report_chat_required');
  return {token,botUsername,chatUsername,studentUsername,adminUsername,hardMentorUsername,softMentorUsername,staffUsernames,clientId,reportChatId,...(chatId?{chatId}:{})};
}

/** Public binding only: changing a test identity requires a new state file, preserving old history. */
export function testBinding(config:TestConfig,chatId:string):string{
  const {token,chatId:expectedChatId,...publicSettings}=config;
  return JSON.stringify({...publicSettings,chatId});
}
