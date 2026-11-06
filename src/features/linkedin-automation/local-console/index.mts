import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {reserveConsolePort} from '../../web-console/backend/reserve-port.mts';
import {readControlConfig} from '../../octo-access/control-config.mts';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {writeTransaction} from '../../../integrations/postgres/working-session.mts';
import {queueDirectProfiles} from '../console-intake/postgres-store.mts';
import {profileRules} from '../../octo-access/profile-reservation.mts';
import {checkProxyCheckerConnection} from '../../octo-access/checker-preflight.mts';
import {ensureCycleClient} from '../../web-console/e2e/linkedin-full-cycle/database.mts';
import {fixtureEmail,assertFixture} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import {bindLocalTestChats,localTestChat} from './test-chat.mts';
const require=createRequire(import.meta.url),express=require('express');
const {createWebConsoleApp}=require('../../web-console/backend/app.ts');
const args=process.argv.slice(2),live=args.includes('--live'),prepare=args.includes('--prepare'),noServe=args.includes('--no-serve');
const fullCycle=args.includes('--full-cycle');
const runId=args.includes('--run-id')?args[args.indexOf('--run-id')+1]:'20261106-local';
if(!/^[a-z0-9-]{8,64}$/.test(runId))throw Error('linkedin_local_invalid_run_id');
let close:()=>Promise<void>=async()=>{},bound:Awaited<ReturnType<typeof reserveConsolePort>>|undefined;
let stage='bind';
try {
  if(!noServe)bound=await reserveConsolePort(Number(process.env.LINKEDIN_LOCAL_PORT||(live?4320:4321)),'127.0.0.1');
  let app:import('express').Express;
  if(!live){const {createLinkedInMockFixture}=await import('./mock-fixture.mts');const f=await createLinkedInMockFixture();app=f.app;close=f.close;
    app.post('/__mock__/profiles/:id/:action',async(req,res)=>{const p=await f.profiles.get(Number(req.params.id));if(!p?.uuid)return void res.sendStatus(404);
      if(req.params.action==='start')await f.cloud.start(p.uuid);else if(req.params.action==='stop')await f.cloud.stop(p.uuid);else return void res.sendStatus(400);res.json({ok:true});});
    console.log('MOCK: ученик для переезда linkedin-local-901@example.invalid; новая заявка linkedin-local-902@example.invalid; пароль 1234. Денис: local-denis / local-test-only.');
  }else{
    stage='control';
    const control=readControlConfig(process.env);if(!control?.url)throw Error('linkedin_local_remote_worker_required');
    const response=await fetch(control.url+'/internal/octo-control/v1/ready',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${control.secret}`,'Content-Type':'application/json'},body:'{}'});
    const body=await response.json();if(response.status!==400||body.error!=='octo_control_invalid_request')throw Error('linkedin_local_worker_unavailable');
    stage='checker';
    await checkProxyCheckerConnection({...process.env,PROXY_CHECKER_BASE_URL:process.env.LINKEDIN_LOCAL_CHECKER_URL||'http://127.0.0.1:8002'});
    const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database);
    let ids:number[]=[];
    try{
      stage='schema';
      await read(async s=>{await s.query('SELECT outlook_forwarding_confirmed_at FROM noco.platform_accounts LIMIT 0');await s.query('SELECT id FROM noco.linkedin_proxy_move LIMIT 0');});
      stage='fixtures';
      if(prepare){ids=await Promise.all(['auto','manual'].map(kind=>ensureCycleClient({pool,config},runId,kind as 'auto'|'manual')));await bindLocalTestChats(pool,config.database,runId);}
      else ids=await read(async s=>{const result:number[]=[];for(const kind of ['auto','manual'] as const){const row=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(runId,kind)])).rows[0];if(!row)throw Error('linkedin_local_prepare_required');assertFixture(row,runId,kind);result.push(Number(row.id));}return result;});
    }finally{await pool.end();}
    const {openSqlConsole}=await import('../../web-console/backend/postgres/runtime.mts');
    stage='runtime';
    const runtime=await openSqlConsole({...process.env,PROXY_CHECKER_BASE_URL:process.env.LINKEDIN_LOCAL_CHECKER_URL||'http://127.0.0.1:8002',LINKLAB_ENABLED:'0',LINKEDIN_PROXY_MOVE_ENABLED:'1',LINKEDIN_LOCAL_TEST_CHAT_ID:localTestChat,LINKEDIN_LOCAL_TEST_CLIENT_ID:String(ids[0]),LINKEDIN_LOCAL_TEST_CLIENT_IDS:ids.join(',')});close=runtime.close;
    stage='prepare';
    if(prepare&&!fullCycle){const account=await runtime.options.linkedinIntake!.load(ids[0]);if(!account.hasLinkedIn)await runtime.options.linkedinIntake!.save(ids[0],
      {scenario:'existing',stage:'credentials',url:`https://www.linkedin.com/in/synthetic-${runId}`,login:fixtureEmail(runId,'auto'),password:'SYNTHETIC-LOCAL-ONLY',loggedIn:false});
      const fixturePool=createPostgresPool(config);
      try{await writeTransaction(fixturePool,config.database,async s=>{
        await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[ids[0]]);
        const row=(await s.query('SELECT * FROM noco.clients WHERE id=$1 FOR UPDATE',[ids[0]])).rows[0];assertFixture(row,runId,'auto');
        const client=await runtime.options.repository.getClientById(ids[0]);
        await queueDirectProfiles(s,ids[0],profileRules.requiredLocalesForMarket(client.market));
      });}finally{await fixturePool.end();}}
    const creator=runtime.options.linkedinCreator!;
    const localCreator={...creator,list:async()=>(await creator.list()).filter(t=>ids.includes(t.clientId)),adminList:async()=>(await creator.adminList()).filter(t=>ids.includes(t.clientId))};
    for(const method of ['detail','profileStatus','saveProxy','acquire','grant','capture','result','status','secrets','adminDetail','adminProfileStatus'] as const){
      const original=creator[method] as (...args:any[])=>Promise<any>;
      (localCreator as any)[method]=async(taskId:unknown,...rest:any[])=>{const detail=await creator.adminDetail(Number(taskId));if(!ids.includes(detail.task.clientId))throw Object.assign(Error('forbidden'),{code:'forbidden',status:403});return original.call(creator,taskId,...rest);};
    }
    stage='app';
    app=createWebConsoleApp({...runtime.options,linkedinCreator:localCreator,linkedinCreatorAuth:{login:'local-denis',password:'local-test-only'},initializeConnectionInviter:false});
    app.get('/api/local/linkedin-ready',(_req,res)=>res.json({localTest:true,remoteOctoWorker:true,runId,testClientIds:ids}));
    await runtime.startLocalBackground();
    console.log(JSON.stringify({mode:'LIVE',runId,clients:ids,studentProxyMove:fixtureEmail(runId,'auto'),studentNewForm:fixtureEmail(runId,'manual'),studentPassword:'1234',denisLogin:'local-denis',denisPassword:'local-test-only'}));
  }
  if(noServe){await close();process.exitCode=0;}
  else{
    app.use('/local-e2e',express.static(resolve('artifacts/linkedin-e2e-20261106')));
    app.use(express.static(resolve('dist/web-console')));
    app.use((req,res)=>{if(req.path.startsWith('/api')||req.path.startsWith('/internal'))return void res.status(404).json({error:'not_found'});res.sendFile(resolve('dist/web-console/index.html'));});
    bound!.attach(app);console.log(`Локальный кабинет: http://127.0.0.1:${(bound!.server.address() as {port:number}).port}`);
    let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void Promise.all([bound!.close(),close()]).catch(()=>{process.exitCode=1;});};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }
} catch(error){await bound?.close();await close();const e=error as {message?:unknown;code?:unknown};const code=String(e.code||'');const message=String(e.message||'');
  console.error(JSON.stringify({error:/^linkedin_local_[a-z_]+$/.test(message)?message:'linkedin_local_start_failed',stage,...(/^[a-zA-Z0-9_]{1,80}$/.test(code)?{code}:{})}));process.exitCode=1;}
