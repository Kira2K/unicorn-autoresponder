import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {COPY_MARKER} from '../contracts.mts';
import {createPostgresPool} from '../pg-pool.mts';
import {createAutomationSqlStore} from './store.mts';
import {acquireLinkedInAuthority} from './authority.mts';
import {readAutomationDiagnostics} from '../../../features/linkedin-automation/orchestrator/diagnostics.ts';
import {createAutomationWriteGuard} from '../../../features/linkedin-automation/orchestrator/execution-guard.ts';
const run=promisify(execFile);
const {Pool}=createRequire(import.meta.url)('pg');
test('real PostgreSQL: optimistic writes, idempotency, durable events, competing writers, connection loss and restart',
  {skip:!process.env.LINKEDIN_TEST_PG_BIN,timeout:120000},async()=>{
  // A fresh local cluster is created for every run. No APP_DB credentials or existing database are read.
  const bin=resolve(process.env.LINKEDIN_TEST_PG_BIN!);
  const base=resolve('.codex-tmp');await mkdir(base,{recursive:true});const directory=await mkdtemp(join(base,'sql-test-'));
  const data=join(directory,'data'),log=join(directory,'postgres.log');
  const socket=createServer();socket.listen(0,'127.0.0.1');await new Promise<void>(r=>socket.once('listening',r));
  const port=(socket.address() as any).port;await new Promise<void>(r=>socket.close(()=>r()));
  const execute=(name:string,args:string[])=>name!=='pg_ctl' ? run(join(bin,`${name}.exe`),args,{windowsHide:true,timeout:60000}) :
    new Promise<void>((yes,no)=>{const child=spawn(join(bin,'pg_ctl.exe'),args,{windowsHide:true,stdio:'ignore'});
      child.once('error',no);child.once('exit',code=>code===0?yes():no(Error(`pg_ctl_exit_${code}`)))});
  await execute('initdb',['-D',data,'-U','test_owner','--auth=trust','--encoding=UTF8','--locale=C']);
  const start=()=>execute('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=15`,'-w','start']);
  const stop=()=>execute('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  await start();let started=true;
  const config={host:'127.0.0.1',port,user:'test_owner',password:'synthetic-local-only',database:'unicorn_noco_copy_restore' as const};
  const admin=new Pool({...config,database:'postgres'});const pool=createPostgresPool(config),second=createPostgresPool(config);
  let leader:Awaited<ReturnType<typeof acquireLinkedInAuthority>>|undefined;
  try{
    const actual=(await admin.query('SHOW data_directory')).rows[0].data_directory;
    assert.equal(resolve(actual),resolve(data),'Only the newly created test cluster may be modified');
    await admin.query('CREATE DATABASE unicorn_noco_copy_restore');
    await admin.query(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}'`);
    const migration=new Pool(config);
    try{await migration.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'))}finally{await migration.end()}
    const storage=createAutomationSqlStore(pool,config.database);
    await assert.rejects(storage.checkSchema(),{code:'automation_withdrawal_import_required'});
    await storage.finishImport();await storage.checkSchema();
    await storage.importWithdrawal(1,{accountId:'fake',attempted:['original']});
    await storage.importWithdrawal(1,{accountId:'fake',attempted:['original']});
    await assert.rejects(storage.importWithdrawal(1,{accountId:'fake',attempted:['unseen']}),{code:'automation_withdrawal_import_conflict'});
    assert.deepEqual((await storage.withdrawals.load(1))?.attempted,['original']);
    const setting={account:1,enabled:true,revision:1,timezone:'Europe/Moscow' as const,slots:[{id:'one',day:1,start:'10:00',end:'20:00',features:['posts' as const]}],updatedAt:1};
    const saved=await Promise.allSettled([storage.store.saveSettings(setting,0),storage.store.saveSettings(setting,0)]);
    assert.equal(saved.filter(r=>r.status==='fulfilled').length,1);
    const job={key:'one',account:1,feature:'posts' as const,date:'2026-09-21',slotId:'one',opensAt:0,closesAt:1000,plannedAt:0,reserveMs:0,state:'running' as const,updatedAt:1,
      pauseBeforeMs:123_456,deadlineAt:900_000};
    await Promise.all([storage.store.claim(job),storage.store.claim(job)]);assert.equal((await storage.store.runs()).length,1);
    await storage.store.saveRun(job,{at:1,account:1,runKey:'one',feature:'posts',stage:'readback',level:'error',code:'unipile_timeout'});
    await storage.store.heartbeat({instance:'test',startedAt:1,at:1,state:'ready'});
    leader=await acquireLinkedInAuthority(pool,config.database);
    await assert.rejects(acquireLinkedInAuthority(second,config.database),{code:'automation_writer_active'});
    assert.deepEqual((await createAutomationSqlStore(second,config.database).store.runs())[0],job);
    await createAutomationWriteGuard(storage.store,leader,undefined,()=>1).beforeWrite(1,'posts','one');
    const unrelated=new Pool(config);
    try {
      await unrelated.query('BEGIN');
      await unrelated.query("SET LOCAL lock_timeout='500ms'");
      await unrelated.query('CREATE TEMP TABLE other_service_probe (value integer NOT NULL)');
      await unrelated.query('INSERT INTO other_service_probe VALUES (1)');
      await unrelated.query('UPDATE other_service_probe SET value=2');
      assert.equal((await unrelated.query('SELECT value FROM other_service_probe')).rows[0].value,2);
      await unrelated.query('COMMIT');
    } finally {await unrelated.end()}
    const owner=(await admin.query(`SELECT pid FROM pg_locks WHERE locktype='advisory' AND granted AND database=(SELECT oid FROM pg_database WHERE datname=$1)`,[config.database])).rows[0].pid;
    await admin.query('SELECT pg_terminate_backend($1)',[owner]);
    await assert.rejects(leader.check(),{code:'automation_writer_unavailable'});
    await assert.rejects(createAutomationWriteGuard(storage.store,leader).beforeWrite(1,'posts','one'),{code:'automation_writer_unavailable'});
    await leader.close();leader=undefined;
    const next=await acquireLinkedInAuthority(second,config.database);await next.close();
    await pool.end();await second.end();await admin.end();
    await stop();started=false;await start();started=true;
    const reopened=createPostgresPool(config);
    try{
      const again=createAutomationSqlStore(reopened,config.database);
      const dayFour=await readAutomationDiagnostics(again.store,4*86400000);
      assert.equal(dayFour.healthy,false);assert.ok(dayFour.events.some(e=>e.code==='unipile_timeout'&&e.stage==='readback'));
      assert.equal((await again.store.runs()).length,1);
      console.log('Fresh isolated PostgreSQL cluster verified; production credentials were never loaded.');
    }finally{await reopened.end()}
  }finally{
    await leader?.close().catch(()=>undefined);
    await Promise.allSettled([pool.end(),second.end(),admin.end()]);if(started)await stop();
  }
});
