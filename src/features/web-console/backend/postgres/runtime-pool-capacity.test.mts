import test from 'node:test';
import assert from 'node:assert/strict';
import {openSqlConsole} from './runtime.mts';
import {runtimeFixture} from './runtime-fixture.mts';
import type {SqlPool} from '../../../../integrations/postgres/contracts.mts';
import {createConfiguredApp} from '../configured-app.mts';
import {serveTestApp} from './workflow-http.mts';

test('lifetime writer lock leaves both data connections available and closes both pools', async()=>{
  const f=runtimeFixture();
  const opened:Array<{pool:SqlPool;active:()=>number;ends:()=>number}>=[];
  const open=()=>{
    let active=0,ends=0;
    const pool:SqlPool={
      async connect(){
        if(active===2)throw Error('bounded_data_pool_exhausted');
        active++;
        const session=await f.pool.connect();let released=false;
        return {async query(text,values){
          const result=await session.query(text,values);
          return text.includes('pg_try_advisory_lock')?{rows:[{owned:true}]}:result;
        },release(destroy){
          if(released)return;released=true;active--;session.release(destroy);
        }};
      },
      async end(){ends++;assert.equal(active,0);}
    };
    opened.push({pool,active:()=>active,ends:()=>ends});return pool;
  };
  const runtime=await openSqlConsole(f.env,open);
  try{
    assert.equal(opened.length,2);
    assert.equal(opened[0].active(),0);
    assert.equal(opened[1].active(),1);
    const readers=await Promise.all([opened[0].pool.connect(),opened[0].pool.connect()]);
    try {await Promise.all(readers.map(s=>s.query('SELECT 1 AS alive')));}
    finally{readers.forEach(s=>s.release());}
  }finally{await runtime.close();await runtime.close();}
  assert.deepEqual(opened.map(p=>p.ends()),[1,1]);
});

test('authority-pool setup failure disables LinkedIn without closing the console data pool',async()=>{
  const f=runtimeFixture();let count=0;
  const runtime=await openSqlConsole(f.env,()=>{
    if(++count===2)throw Error('authority_pool_failed');return f.pool;
  });
  try {
    assert.equal(f.state.ends,0);
    assert.equal(runtime.options.linkedinStorage.automationUnavailable,'automation_startup_failed');
    assert.equal(runtime.options.linkedinStorage.executionControl?.leader,false);
    await assert.rejects(runtime.options.linkedinStorage.executionControl!.authority.check(),{code:'automation_startup_failed'});
    assert.deepEqual(await runtime.options.repository.listPlatforms(),[]);
  } finally {await runtime.close();await runtime.close();}
  assert.equal(f.state.ends,1);
});

for(const enabled of ['true','false']) for(const scenario of [
  {version:1,withdrawals_imported:false,code:'automation_withdrawal_import_required'},
  {version:2,withdrawals_imported:true,code:'automation_schema_required'},
  {version:1,withdrawals_imported:true,code:'postgres_read_unavailable',offline:true}
]) test(`LinkedIn preflight ${scenario.code}, enabled=${enabled}: console remains readable, writes fail closed`,async()=>{
  const f=runtimeFixture(),connect=f.pool.connect;
  f.pool.connect=async()=>{
    const session=await connect();
    return {...session,async query(text,values){
      const result=await session.query(text,values);
      if(text.includes('pg_try_advisory_lock'))return {rows:[{owned:true}]};
      if(text.includes('to_regclass'))return {rows:[{schema_table:'linkedin_automation.schema_version'}]};
      if(text.includes('SELECT version,withdrawals_imported')) {
        if(scenario.offline)throw Object.assign(Error('private database connection detail'),{code:'08006'});
        return {rows:[scenario]};
      }
      return result;
    }};
  };
  const runtime=await openSqlConsole({...f.env,LINKEDIN_ORCHESTRATOR_ENABLED:enabled},()=>f.pool);
  try {
    assert.equal(f.state.ends,0,'main pool remains open');
    assert.deepEqual(await runtime.options.repository.listPlatforms(),[]);
    assert.equal(runtime.options.linkedinStorage.automation,undefined);
    assert.equal(runtime.options.linkedinStorage.automationUnavailable,scenario.code);
    const control=runtime.options.linkedinStorage.executionControl!;
    assert.equal(control.leader,false,'no legacy scheduler or recovery fallback');
    assert.throws(()=>control.authority.assertOwned(),{code:scenario.code});
    await assert.rejects(control.authority.check(),{code:scenario.code});
    assert.equal(f.calls.filter(sql=>sql.includes('pg_advisory_unlock')).length,1);
    assert.ok(!f.calls.some(sql=>/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/.test(sql)));
  } finally {await runtime.close();await runtime.close();}
  assert.equal(f.state.ends,1);
  assert.equal(f.calls.filter(sql=>sql.includes('pg_advisory_unlock')).length,1);
});

test('normal entrypoint serves login and console with LinkedIn disabled after preflight failure',async()=>{
  const f=runtimeFixture();let pools=0;
  const runtime=await openSqlConsole(f.env,()=>{
    if(++pools===2)throw Error('authority offline');return f.pool;
  });
  const configured=await createConfiguredApp(f.env,async()=>runtime);
  const server=await serveTestApp(configured.app);
  try {
    const login=await fetch(`${server.base}/api/auth/login`,{method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'unicornveryevil@gmail.com',password:'101010'})});
    assert.equal(login.status,200);
    const headers={Cookie:String(login.headers.get('set-cookie')).split(';')[0],'Content-Type':'application/json'};
    assert.equal((await fetch(`${server.base}/api/admin/noco-queue`,{headers})).status,200);
    assert.equal((await fetch(`${server.base}/api/admin/linkedin/accounts`,{headers})).status,200);
    const automation=await fetch(`${server.base}/api/admin/linkedin/automation`,{headers});
    assert.equal(automation.status,503);
    assert.equal((await automation.json()).error,'automation_startup_failed');
    const mutation=await fetch(`${server.base}/api/admin/linkedin/accounts/21`,{method:'PATCH',headers,
      body:JSON.stringify({linkedinUrl:'https://linkedin.com/in/synthetic-test'})});
    assert.equal(mutation.ok,false);
    await configured.app.locals.recoverProfileVerification();
    assert.ok(!f.calls.some(sql=>/\b(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/.test(sql)));
  } finally {await server.close();await configured.closeStorage();}
  assert.equal(f.state.ends,1);
});
