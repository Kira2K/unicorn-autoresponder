import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COPY_MARKER } from '../contracts.mts';
import { clientLifecycleStore } from '../../../features/client-lifecycle/postgres-store.mts';

const configPath=process.env.NOTIFICATION_PACING_TEST_CONFIG;
test('automatic notification spacing: real isolated PostgreSQL, no Telegram',
  {skip:!configPath},async t=>{
    const cfg=JSON.parse(readFileSync(configPath!,'utf8'));
    assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');
    assert.equal(cfg.database,'unicorn_noco_copy_restore');
    const {Pool}=createRequire(import.meta.url)('pg');
    const pool=new Pool({host:cfg.host,port:cfg.port,user:cfg.user,database:cfg.database,max:8});
    const sql=readFileSync(new URL('./001-pacing.up.sql',import.meta.url),'utf8');
    const q=(s:string,v?:unknown[])=>pool.query(s,v);
    const reset=async()=>q("UPDATE noco.telegram_notification_pacing SET next_send_at='-infinity'; TRUNCATE noco.client_notifications");
    try{
      assert.equal((await q("SELECT to_regnamespace('noco') AS s")).rows[0].s,null);
      await q(`COMMENT ON DATABASE unicorn_noco_copy_restore IS '${COPY_MARKER}';
        CREATE SCHEMA noco;
        CREATE ROLE unicorn_sql_app; CREATE ROLE crm_unicorn_app;
        GRANT USAGE ON SCHEMA noco TO unicorn_sql_app,crm_unicorn_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA noco GRANT ALL ON TABLES TO unicorn_sql_app,crm_unicorn_app;
        CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_status text,client_role text,
          secured_general_chat_id text,telegram_general_chat_id text,telegram_personal_chat_id text,
          google_folder text,tg_hard_mentor text,client_name text,market_id bigint,__nc_deleted boolean);
        INSERT INTO noco.clients(id,client_status) VALUES(1,'onboarding'),(2,'onboarding');
        CREATE TABLE noco.client_notifications(event_key text PRIMARY KEY,client_id bigint,kind text,
          points jsonb,attempted_at timestamptz,outcome text DEFAULT 'claimed',message_id bigint,
          error_code text,retry_at timestamptz,sent_at timestamptz);`);
      await q(sql);
      const slot=async()=> (await q('SELECT noco.telegram_notification_try_claim() AS ok')).rows[0].ok;
      await t.test('first attempt reserves five seconds, not a random interval',async()=>{
        await reset();assert.equal(await slot(),true);
        const remaining=Number((await q('SELECT extract(epoch FROM next_send_at-clock_timestamp()) AS seconds FROM noco.telegram_notification_pacing')).rows[0].seconds);
        assert(remaining>4 && remaining<=5);
        assert.equal(await slot(),false);
        await setTimeout(5050);
        assert.equal(await slot(),true,'the ordinary SQL clock reopens the slot after five seconds');
      });
      await t.test('concurrent senders share one atomic slot',async()=>{
        await reset();assert.equal((await Promise.all(Array.from({length:8},slot))).filter(Boolean).length,1);
      });
      await t.test('reinstallation and a different connection do not reset the deadline',async()=>{
        await reset();assert.equal(await slot(),true);await q(sql);
        // A fresh Node process has no access to any old in-memory limiter.
        const child=await promisify(execFile)(process.execPath,['--input-type=commonjs','-e',
          `const {Client}=require('pg');const c=new Client(JSON.parse(process.argv[1]));
           (async()=>{await c.connect();try{console.log((await c.query(
             'SELECT noco.telegram_notification_try_claim() AS ok')).rows[0].ok)}finally{await c.end()}})()
           .catch(()=>process.exitCode=1);`,JSON.stringify({host:cfg.host,port:cfg.port,user:cfg.user,database:cfg.database})],
          {cwd:new URL('../../../../',import.meta.url),timeout:10000});
        assert.equal(child.stdout.trim(),'false');
      });
      await t.test('a rolled-back transaction does not consume the next slot',async()=>{
        await reset();const session=await pool.connect();
        try{
          await session.query('BEGIN');
          assert.equal((await session.query('SELECT noco.telegram_notification_try_claim() AS ok')).rows[0].ok,true);
          await session.query('ROLLBACK');
        }finally{session.release();}
        assert.equal(await slot(),true);
      });
      await t.test('ordinary roles reserve slots but cannot edit pacing timestamps',async()=>{
        await reset();const session=await pool.connect();
        try{
          for(const role of ['unicorn_sql_app','crm_unicorn_app']){
            await session.query('SET ROLE '+role);
            assert.equal((await session.query('SELECT noco.telegram_notification_try_claim() AS ok')).rows[0].ok,role==='unicorn_sql_app');
            await assert.rejects(session.query("UPDATE noco.telegram_notification_pacing SET next_send_at='-infinity'"));
            await session.query('RESET ROLE');
          }
        }finally{session.release();}
      });
      await t.test('waiting does not consume a message, and restart resumes it once',async()=>{
        await reset();let store=clientLifecycleStore(pool,cfg.database);const now=new Date();
        assert.equal(await store.delivery.claim('one',1,'welcome',[],now,'onboarding'),true);
        await store.delivery.finish('one',{outcome:'sent',messageId:1});
        assert.equal(await store.delivery.claim('two',2,'welcome',[],now,'onboarding'),'deferred');
        assert.equal((await q("SELECT count(*) FROM noco.client_notifications WHERE event_key='two'")).rows[0].count,'0');
        // Owner-controlled clock advance on the isolated test DB only.
        await q("UPDATE noco.telegram_notification_pacing SET next_send_at=clock_timestamp()-interval '1 millisecond'");
        store=clientLifecycleStore(pool,cfg.database);
        assert.equal(await store.delivery.claim('two',2,'welcome',[],now,'onboarding'),true);
        await store.delivery.finish('two',{outcome:'sent',messageId:2});
        assert.equal(await store.delivery.claim('two',2,'welcome',[],now,'onboarding'),false);
      });
      await t.test('application clock cannot bypass SQL spacing',async()=>{
        await reset();const store=clientLifecycleStore(pool,cfg.database);
        assert.equal(await store.delivery.claim('one',1,'welcome',[],new Date(),'onboarding'),true);
        assert.equal(await store.delivery.claim('two',2,'welcome',[],new Date(Date.now()+86400000),'onboarding'),'deferred');
      });
      await t.test('a CRM reservation defers Clients without dropping their message',async()=>{
        await reset();const session=await pool.connect();
        try{
          await session.query('SET ROLE crm_unicorn_app');
          assert.equal((await session.query('SELECT noco.telegram_notification_try_claim() AS ok')).rows[0].ok,true);
        }finally{await session.query('RESET ROLE');session.release();}
        const store=clientLifecycleStore(pool,cfg.database);
        assert.equal(await store.delivery.claim('clients-waits-for-crm',1,'welcome',[],new Date(),'onboarding'),'deferred');
        assert.equal((await q('SELECT count(*) FROM noco.client_notifications')).rows[0].count,'0');
      });
      await t.test('429 keeps its own longer retry_after across restart',async()=>{
        await reset();const now=new Date();let store=clientLifecycleStore(pool,cfg.database);
        assert.equal(await store.delivery.claim('limited',1,'welcome',[],now,'onboarding'),true);
        await store.delivery.finish('limited',{outcome:'failed',code:'telegram_429',retryAfterSeconds:120});
        await q("UPDATE noco.telegram_notification_pacing SET next_send_at='-infinity'");
        store=clientLifecycleStore(pool,cfg.database);
        assert.equal(await store.delivery.claim('limited',1,'welcome',[],now,'onboarding'),'deferred');
        assert.equal((await q("SELECT outcome FROM noco.client_notifications WHERE event_key='limited'")).rows[0].outcome,'failed');
        await q("UPDATE noco.client_notifications SET retry_at=clock_timestamp()-interval '1 second'");
        assert.equal(await store.delivery.claim('limited',1,'welcome',[],new Date(),'onboarding'),true);
        await store.delivery.finish('limited',{outcome:'sent',messageId:3});
        assert.equal(await store.delivery.claim('limited',1,'welcome',[],new Date(),'onboarding'),false);
      });
      await t.test('an uncertain delivery never consumes another slot or sends again',async()=>{
        await reset();const store=clientLifecycleStore(pool,cfg.database);const now=new Date();
        assert.equal(await store.delivery.claim('unknown',1,'welcome',[],now,'onboarding'),true);
        await store.delivery.finish('unknown',{outcome:'uncertain',code:'lost_response'});
        await q("UPDATE noco.telegram_notification_pacing SET next_send_at='-infinity'");
        assert.equal(await store.delivery.claim('unknown',1,'welcome',[],now,'onboarding'),false);
        assert.equal(await slot(),true);
      });
      await t.test('missing migration fails closed before persisting a delivery claim',async()=>{
        await reset();await q('DROP FUNCTION noco.telegram_notification_try_claim()');
        const store=clientLifecycleStore(pool,cfg.database);
        await assert.rejects(store.delivery.claim('missing',1,'welcome',[],new Date(),'onboarding'));
        assert.equal((await q('SELECT count(*) FROM noco.client_notifications')).rows[0].count,'0');
      });
    }finally{await pool.end();}
  });
