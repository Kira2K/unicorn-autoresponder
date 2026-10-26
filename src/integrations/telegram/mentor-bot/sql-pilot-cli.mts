import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'dotenv';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createPostgresPool} from '../../postgres/pg-pool.mts';
import {readTestConfig} from './test-config.mts';
import {pilotScope} from './pilot-scope.mts';
import {pilotStaffAllowed} from './pilot-staff-access.mts';
import type {Client} from './types.mts';
import {mentorTelegram} from './telegram-adapter.mts';
import {scopeTestTransport,verifyTestTelegram} from './test-transport.mts';
import {checkPilotDatabase,preparePilotDatabase,readPilotStatus} from './pilot-database.mts';
import {postgresStore} from './postgres-store.mts';
import {postgresLock} from './postgres-lock.mts';
import {MENTOR_ALLOWED_UPDATES} from './runtime.mts';
import {enroll} from './schedule.mts';
import {createMentorWorker} from './worker.mts';
import {storageFailureCode,telegramErrorCode} from './failures.mts';
import {configureMentorCommands} from './command-menu.mts';

export function readSqlPilotArgs(args:string[]){
  let mode='',envFile='',clientId='',dbEnvFile='',useTestChat=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--check','--prepare','--start','--status'].includes(arg)&&!mode)mode=arg;
    else if(arg==='--use-test-chat'&&!useTestChat)useTestChat=true;
    else if(['--env-file','--client-id','--db-env-file'].includes(arg)&&args[i+1]&&!args[i+1].startsWith('--')){
      if(arg==='--env-file'&&!envFile)envFile=args[++i];
      else if(arg==='--client-id'&&!clientId)clientId=args[++i];
      else if(arg==='--db-env-file'&&!dbEnvFile)dbEnvFile=args[++i];
      else throw new Error('mentor_pilot_arguments_invalid');
    }else throw new Error('mentor_pilot_arguments_invalid');
  }
  if(!mode||!envFile||!/^[1-9]\d*$/.test(clientId)||!Number.isSafeInteger(Number(clientId)))
    throw new Error('mentor_pilot_arguments_invalid');
  return {mode,envFile,clientId,...(dbEnvFile?{dbEnvFile}:{}),...(useTestChat?{useTestChat:true}:{})};
}

/** Secondary ENV is an explicit SQL-only source: it cannot replace bot credentials or test roles. */
export function readSqlPilotSettings(env:Readonly<Record<string,string|undefined>>,databaseEnv?:Readonly<Record<string,string|undefined>>){
  return {config:readTestConfig(env),source:readPostgresAppDbConfig(databaseEnv??env)};
}

/** Importing this entrypoint never reads ENV, connects or starts a worker. */
export async function main(args=process.argv.slice(2)){
  const {mode,envFile,clientId,dbEnvFile,useTestChat}=readSqlPilotArgs(args);
  const env=parse(await readFile(resolve(envFile)));
  const databaseEnv=dbEnvFile?parse(await readFile(resolve(dbEnvFile))):undefined;
  const {config,source}=readSqlPilotSettings(env,databaseEnv);
  if(config.clientId!==clientId)throw new Error('mentor_pilot_client_confirmation_mismatch');
  if(!config.chatId)throw new Error('mentor_pilot_numeric_chat_required');
  const pool=createPostgresPool(source);
  const scope=pilotScope(config,config.chatId,{useTestChat}),gate={database:source.database,environment:'local-test' as const,pilot:scope};
  const databaseInfo={database:source.database,dbEnvFile:resolve(dbEnvFile||envFile)};
  try{
    if(mode==='--status'){
      console.info(JSON.stringify({mode:'sql-pilot-status',...databaseInfo,...await readPilotStatus(pool,source.database,scope)},null,2));
      return;
    }
    const transport=mentorTelegram({token:config.token,requester:globalThis.fetch});
    await verifyTestTelegram(transport.api,config);
    if(mode==='--prepare'){
      console.info(JSON.stringify({mode:'sql-pilot-prepare',...databaseInfo,...await preparePilotDatabase(pool,source.database,scope)}));return;
    }
    const check=await checkPilotDatabase(pool,source.database,scope);
    console.info(JSON.stringify({mode:mode==='--check'?'sql-pilot-preflight':'sql-pilot-start',...databaseInfo,...check,
      student:config.studentUsername,staff:config.staffUsernames,chatId:scope.chatId,reportChatId:scope.reportChatId,
      staffAccess:'configured-staff-and-current-client-mentors',
      postgresAccess:mode==='--check'?'read-only':'one-client-read-write'}));
    if(!check.ready)throw new Error(!check.chatSafe?'mentor_pilot_source_binding':!check.schemaPrepared?
      'mentor_pilot_schema_missing':!check.canUpdateClient?'mentor_pilot_update_permission_required':'mentor_pilot_status_history_required');
    if(mode==='--check')return;
    const store=postgresStore(pool,gate),lock=postgresLock(pool,gate);
    if(!await lock.acquire())throw new Error('mentor_pilot_already_running');
    const stop=new AbortController(),abort=()=>stop.abort();
    process.once('SIGINT',abort);process.once('SIGTERM',abort);
    try{
      await configureMentorCommands(transport.api,scope.chatId).catch(error=>console.warn(JSON.stringify({
        event:'mentor_command_menu_failed',code:storageFailureCode(error),telegramCode:telegramErrorCode(error)})));
      await store.transaction(s=>enroll(s,clientId,Date.now()));
      // Old local JSON and pre-activation Telegram commands are deliberately not imported.
      if(!await store.transaction(s=>!!s.operations['test:initialized'])){
        const pending=await transport.api.getUpdates(-1,0,MENTOR_ALLOWED_UPDATES);
        const ids=pending.map(u=>(u as {update_id?:unknown})?.update_id).filter((id):id is number=>
          typeof id==='number'&&Number.isSafeInteger(id)&&id>=0);
        await store.transaction(s=>{
          if(ids.length)s.offset=Math.max(s.offset,...ids.map(id=>id+1));
          s.operations['test:initialized']={at:Date.now()};
        });
      }
      console.info('SQL-пилот запущен для ученика '+clientId+'. /menu@'+config.botUsername+' в тестовой группе. Остановка: Ctrl+C.');
      const staffAllowed=(client:Client,actor:string)=>pilotStaffAllowed(config,client,actor);
      const scoped=scopeTestTransport(transport,config,scope.chatId,
        actor=>store.transaction(s=>pilotStaffAllowed(config,s.clients[clientId],actor)));
      await createMentorWorker({...scoped,store,staffAllowed,
        lock:{acquire:async()=>true,assertHeld:()=>lock.assertHeld(),release:()=>lock.release()},
        reportChatId:scope.reportChatId,botUsername:config.botUsername}).start(stop.signal);
    }finally{
      process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);await lock.release();
    }
  }finally{await pool.end();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{
    const candidate=String((error as {code?:unknown})?.code??'');
    const code=storageFailureCode(error)!=='mentor_transaction_failed'?storageFailureCode(error):
      /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate)?'postgres_'+candidate:
      ['invalid_appdb_postgres_config','tls_or_local_tunnel_required','invalid_postgres_config'].includes(candidate)?candidate:
      'mentor_pilot_start_failed';
    const telegramCode=telegramErrorCode(error);
    const hints:Record<string,string>={
      mentor_pilot_arguments_invalid:'Укажи --env-file .env --client-id <ID> и один из --check, --prepare, --start, --status. Дополнительно: --db-env-file <SQL ENV> и --use-test-chat.',
      mentor_pilot_client_confirmation_mismatch:'--client-id должен совпадать с MENTOR_BOT_TEST_CLIENT_ID в выбранном ENV.',
      mentor_pilot_numeric_chat_required:'Для SQL-пилота требуется MENTOR_BOT_TEST_CHAT_ID.',
      mentor_pilot_source_binding:'В карточке задан другой общий чат. Допустим пустой чат или тестовая группа. Запуск остановлен без смены статуса.',
      mentor_pilot_schema_missing:'Сначала выполни эту команду с --prepare вместо --check/--start.',
      mentor_pilot_binding:'Сохранённая привязка SQL-пилота отличается от ENV. История не перезаписывается.',
      mentor_pilot_update_permission_required:'Роли БД нужны права UPDATE полей client_status, market_id, tg_hard_mentor и tg_soft_mentor. --prepare не расширяет права на noco.clients.',
      mentor_pilot_status_history_required:'Нужен транзакционный триггер истории пилота. Выполни --prepare. Переход без новой записи истории откатывается.',
      postgres_42501:'Недостаточно прав БД. Для --prepare нужны CREATE схемы и TRIGGER на noco.clients либо доступ к существующей роли unicorn_noco_copy_owner. Права и роли команда не расширяет.',
      postgres_ECONNREFUSED:'Соединение с PostgreSQL отклонено. Проверь локальный сервер или туннель из APP_DB_POSTGRES_HOST/PORT.',
      postgres_EPERM:'Окружение не разрешило соединение с PostgreSQL. Запусти команду в обычном терминале проекта.',
      postgres_EACCES:'Окружение не разрешило соединение с PostgreSQL. Запусти команду в обычном терминале проекта.'
    };
    console.error(JSON.stringify({event:'mentor_sql_pilot_failed',code,...(telegramCode?{telegramCode}:{}),
      ...(hints[code]?{hint:hints[code]}:{})}));process.exitCode=1;
  });
}
