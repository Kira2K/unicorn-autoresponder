import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {SqlPool} from '../../postgres/contracts.mts';
import {COPY_MARKER} from '../../postgres/contracts.mts';
import {checkPilotDatabase,preparePilotDatabase,readPilotStatus} from './pilot-database.mts';
import {readSqlPilotArgs,readSqlPilotSettings} from './sql-pilot-cli.mts';
import {pilotChatSafe,pilotScope} from './pilot-scope.mts';
import type {PilotScope} from './pilot-scope.mts';

const scope:PilotScope={clientId:'204',binding:'public-binding',studentUsername:'teststudent',chatId:'-100',reportChatId:'-900',
  hardMentor:'@testhard',softMentor:'@testsoft'};
function fixture(options:{prepared?:boolean;binding?:string;chat?:string;grantFailure?:boolean;directPreparation?:boolean}={}){
  const queries:{sql:string;values:unknown[]}[]=[];let releases=0;
  const pool:SqlPool={async connect(){return {release(){releases++;},async query(sql,values=[]){
    queries.push({sql,values});
    if(sql.includes('shobj_description'))return {rows:[{database:'unicorn_noco_copy_restore',marker:COPY_MARKER}]};
    if(sql.startsWith('SELECT current_database()'))return {rows:[{database:'unicorn_noco_copy_restore',environment:'local-test',binding:options.binding??scope.binding}]};
    if(sql.startsWith('SELECT c.id'))return {rows:[{id:'204',client_name:'Synthetic',client_status:'studying',market_id:1,chat_id:options.chat??'-100'}]};
    if(sql.includes('ORDER BY id DESC'))return {rows:[{id:1,old_status:'new',new_status:'studying',changed_at:'2026-10-22'}]};
    if(sql.includes('has_column_privilege'))return {rows:[{can_update_client:true,has_update_trigger:true,schema_prepared:!!options.prepared}]};
    if(sql.startsWith('SELECT to_regclass'))return {rows:[{prepared:!!options.prepared}]};
    if(sql.startsWith('SELECT current_user'))return {rows:[{app_role:'test_app',can_prepare_direct:!!options.directPreparation}]};
    if(sql.startsWith('GRANT')&&options.grantFailure)throw Object.assign(new Error('synthetic permission failure'),{code:'42501'});
    return {rows:[]};
  }};},async end(){}};
  return {pool,queries,releases:()=>releases};
}

test('SQL pilot requires an explicit client and a single explicit action',()=>{
  assert.deepEqual(readSqlPilotArgs(['--env-file','.env','--client-id','204','--check']),
    {mode:'--check',envFile:'.env',clientId:'204'});
  for(const args of [[],['--start'],['--env-file','.env','--start'],
    ['--env-file','.env','--client-id','204','--check','--start'],
    ['--env-file','.env','--client-id','1; DROP','--start']])assert.throws(()=>readSqlPilotArgs(args));
});

test('explicit SQL configuration preserves the current bot roles and never falls back from incomplete SQL credentials',()=>{
  const env={MENTOR_BOT_API_KEY:'fixture-mentor-token',MENTOR_BOT_USERNAME:'veumentorbot',
    MENTOR_BOT_REPORT_CHAT_ID:'-900',MENTOR_BOT_TEST_CLIENT_ID:'204',MENTOR_BOT_TEST_CHAT_USERNAME:'mentorbotqa',
    MENTOR_BOT_TEST_CHAT_ID:'-100',MENTOR_BOT_TEST_STUDENT_USERNAME:'teststudent',MENTOR_BOT_TEST_ADMIN_USERNAME:'testadmin',
    APP_DB_POSTGRES_HOST:'127.0.0.1',APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy_restore',
    APP_DB_POSTGRES_USER:'restore_fixture',APP_DB_POSTGRES_PASSWORD:'restore_fixture_password'};
  const sqlEnv={APP_DB_POSTGRES_HOST:'localhost',APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy',
    APP_DB_POSTGRES_USER:'working_fixture',APP_DB_POSTGRES_PASSWORD:'working_fixture_password',
    MENTOR_BOT_API_KEY:'wrong-bot',MENTOR_BOT_TEST_STUDENT_USERNAME:'wrongstudent'};
  const settings=readSqlPilotSettings(env,sqlEnv);
  assert.equal(settings.source.database,'unicorn_noco_copy');assert.equal(settings.source.user,'working_fixture');
  assert.equal(settings.config.token,'fixture-mentor-token');assert.equal(settings.config.studentUsername,'teststudent');
  assert.notEqual(pilotScope(settings.config,'-100').binding,pilotScope(settings.config,'-100',{useTestChat:true}).binding);
  assert.equal(readSqlPilotSettings(env).source.database,'unicorn_noco_copy_restore');
  assert.throws(()=>readSqlPilotSettings(env,{APP_DB_POSTGRES_DATABASE:'unicorn_noco_copy'}));
  assert.deepEqual(readSqlPilotArgs(['--env-file','.env','--db-env-file','.env original','--client-id','204','--use-test-chat','--start']),
    {mode:'--start',envFile:'.env',clientId:'204',dbEnvFile:'.env original',useTestChat:true});
});

test('canonical chat mismatch requires an explicit test-chat override',()=>{
  assert.equal(pilotChatSafe('8160624747',scope),false);
  assert.equal(pilotChatSafe('8160624747',{...scope,useTestChat:true}),true);
});

test('preparation uses the current role when its existing DDL rights suffice, without changing roles',async()=>{
  const f=fixture({directPreparation:true});
  await preparePilotDatabase(f.pool,'unicorn_noco_copy_restore',scope);
  assert.equal(f.queries.at(-1)?.sql,'COMMIT');
  assert.equal(f.queries.some(q=>q.sql.startsWith('SET LOCAL ROLE')),false);
});

test('preflight and status remain read-only even before schema preparation',async()=>{
  const f=fixture();
  const check=await checkPilotDatabase(f.pool,'unicorn_noco_copy_restore',scope);
  assert.equal(check.ready,false);assert.equal(check.schemaPrepared,false);assert.equal(check.chatSafe,true);
  const status=await readPilotStatus(f.pool,'unicorn_noco_copy_restore',scope);
  assert.equal(status.sourceStatus,'studying');assert.equal(status.history.length,0);assert.equal(status.historyAvailable,false);
  assert.equal(f.queries.some(q=>/^(UPDATE|INSERT|DELETE|CREATE|ALTER|GRANT|SET LOCAL ROLE)/.test(q.sql)),false);
  assert.equal(f.queries.filter(q=>q.sql==='BEGIN READ ONLY').length,2);assert.equal(f.releases(),2);
  assert.ok(f.queries.filter(q=>q.sql.startsWith('SELECT c.id')||q.sql.includes('ORDER BY id DESC'))
    .every(q=>q.sql.includes('id=$1')&&q.values[0]==='204'));
});

test('setup prepares isolated state and a scoped trigger without client-row writes; failed grants roll back',async()=>{
  const f=fixture();
  await preparePilotDatabase(f.pool,'unicorn_noco_copy_restore',scope);
  assert.equal(f.queries.at(-1)?.sql,'COMMIT');
  assert.ok(f.queries.some(q=>q.sql.includes('CREATE SCHEMA IF NOT EXISTS mentor_bot_pilot_204')));
  assert.equal(f.queries.some(q=>/^(UPDATE|INSERT INTO|ALTER TABLE|GRANT).*noco\./.test(q.sql)),false);
  assert.ok(f.queries.filter(q=>q.sql.startsWith('GRANT')).every(q=>q.sql.includes('mentor_bot_pilot_204')));
  const bad=fixture({grantFailure:true});
  await assert.rejects(preparePilotDatabase(bad.pool,'unicorn_noco_copy_restore',scope));
  assert.equal(bad.queries.at(-1)?.sql,'ROLLBACK');assert.equal(bad.releases(),1);
});

test('setup and check reject changed bindings; a wrong canonical chat cannot create state',async()=>{
  const changed=fixture({prepared:true,binding:'other-test'});
  await assert.rejects(preparePilotDatabase(changed.pool,'unicorn_noco_copy_restore',scope),/mentor_pilot_binding/);
  await assert.rejects(checkPilotDatabase(changed.pool,'unicorn_noco_copy_restore',scope),/mentor_pilot_binding/);
  assert.equal(changed.queries.some(q=>q.sql.startsWith('SET LOCAL ROLE')||q.sql.includes('CREATE SCHEMA')),false);
  const wrong=fixture({chat:'-200'});
  await assert.rejects(preparePilotDatabase(wrong.pool,'unicorn_noco_copy_restore',scope),/mentor_pilot_source_binding/);
  assert.equal(wrong.queries.some(q=>q.sql.includes('CREATE SCHEMA')),false);
});
