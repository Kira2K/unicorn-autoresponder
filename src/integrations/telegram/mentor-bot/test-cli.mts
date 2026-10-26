import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {parse} from 'dotenv';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import type {SqlResult} from '../../postgres/contracts.mts';
import {readTestConfig,testBinding} from './test-config.mts';
import {readTestClient} from './test-client.mts';
import {verifyTestTelegram,scopeTestTransport} from './test-transport.mts';
import {mentorTelegram} from './telegram-adapter.mts';
import {emptyState} from './types.mts';
import {enroll} from './schedule.mts';
import {openFileStore} from './file-store.mts';
import {memoryLock,MENTOR_ALLOWED_UPDATES} from './runtime.mts';
import {createMentorWorker} from './worker.mts';
import {telegramErrorCode} from './failures.mts';
import {configureMentorCommands} from './command-menu.mts';

/** Explicit local pilot only. The existing offline CLI remains unchanged. */
async function main(){
  const args=process.argv.slice(2);
  let envFile='',stateFile='',mode='';
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--check','--start'].includes(arg)&&!mode)mode=arg;
    else if(['--env-file','--state-file'].includes(arg)&&args[i+1]&&!args[i+1].startsWith('--')){
      if(arg==='--env-file'&&!envFile)envFile=args[++i];
      else if(arg==='--state-file'&&!stateFile)stateFile=args[++i];
      else throw new Error('mentor_test_arguments_invalid');
    }else throw new Error('mentor_test_arguments_invalid');
  }
  if(!mode||!envFile)throw new Error('mentor_test_arguments_invalid');
  const env=parse(await readFile(resolve(envFile))),config=readTestConfig(env);
  const source=readPostgresAppDbConfig(env);
  const transport=mentorTelegram({token:config.token,requester:globalThis.fetch});
  const chatId=await verifyTestTelegram(transport.api,config);
  const require=createRequire(import.meta.url);
  const {Client}=require('pg') as {Client:new(options:unknown)=>{
    connect():Promise<void>;query(sql:string,values?:unknown[]):Promise<SqlResult>;end():Promise<void>}};
  const db=new Client({...source,connectionTimeoutMillis:10000,statement_timeout:10000,
    options:'-c default_transaction_read_only=on'});
  let client;
  try{await db.connect();client=await readTestClient(db,config,chatId);}finally{await db.end();}
  const file=resolve(stateFile||'storage/mentor-bot/client-'+config.clientId+'.json');
  console.info(JSON.stringify({mode:mode==='--check'?'pilot-preflight':'pilot-start',bot:config.botUsername,
    clientId:client.id,clientName:client.name,sourceStatus:client.status,chatId,reportChatId:config.reportChatId,
    student:config.studentUsername,staff:config.staffUsernames,stateFile:file,postgresAccess:'read-only'}));
  if(mode==='--check')return;
  const initial=emptyState([client]);enroll(initial,client.id,Date.now());
  const store=await openFileStore(file,testBinding(config,chatId),initial);
  const stop=new AbortController(),abort=()=>stop.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    await configureMentorCommands(transport.api,chatId).catch(error=>console.warn(JSON.stringify({
      event:'mentor_command_menu_failed',telegramCode:telegramErrorCode(error)})));
    // On first activation ignore queued pre-test commands; subsequent starts resume the saved offset.
    if(!await store.transaction(s=>!!s.operations['test:initialized'])){
      const pending=await transport.api.getUpdates(-1,0,MENTOR_ALLOWED_UPDATES);
      const ids=pending.map(u=>(u as {update_id?:unknown})?.update_id).filter((id):id is number=>
        typeof id==='number'&&Number.isSafeInteger(id)&&id>=0);
      await store.transaction(s=>{
        if(ids.length)s.offset=Math.max(s.offset,...ids.map(id=>id+1));
        s.operations['test:initialized']={at:Date.now()};
      });
    }
    const scoped=scopeTestTransport(transport,config,chatId);
    console.info('Ментор-бот запущен. В тестовой группе отправь /menu@'+config.botUsername+'. Остановка: Ctrl+C.');
    await createMentorWorker({...scoped,store,lock:memoryLock(),reportChatId:config.reportChatId,
      botUsername:config.botUsername}).start(stop.signal);
  }finally{
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);await store.close();
  }
}

main().catch(error=>{
  const candidate=String(error?.code??error?.message??'');
  const code=/^[a-zA-Z0-9_]{1,80}(?::[A-Z_]+)?$/.test(candidate)?candidate:'mentor_test_start_failed';
  const telegramCode=telegramErrorCode(error);
  const tips:Record<string,string>={
    mentor_test_arguments_invalid:'Укажи --env-file <путь> и --check либо --start. Дополнительно: --state-file <путь>.',
    mentor_test_bot_admin_required:'Назначь ментор-бота администратором тестовой группы и повтори проверку.',
    mentor_test_bot_mismatch:'Токен MENTOR_BOT_API_KEY не соответствует MENTOR_BOT_USERNAME.',
    mentor_test_group_mismatch:'MENTOR_BOT_TEST_CHAT_ID не соответствует группе MENTOR_BOT_TEST_CHAT_USERNAME.',
    mentor_test_report_chat_unavailable:'Добавь ментор-бота в MENTOR_BOT_REPORT_CHAT_ID с правом отправлять сообщения либо укажи согласованный доступный чат отчётов.',
    mentor_test_state_locked:'Этот файл состояния занят. Останови другой тестовый процесс. После аварии проверь PID в .lock перед его удалением.',
    mentor_test_state_binding_mismatch:'Настройки участников или чата изменились. Укажи новый --state-file, сохранив прежнюю историю.'
  };
  console.error(JSON.stringify({event:'mentor_test_failed',code,...(telegramCode?{telegramCode}:{}),
    ...(tips[code]?{hint:tips[code]}:{})}));
  process.exitCode=1;
});
