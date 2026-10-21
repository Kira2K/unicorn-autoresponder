import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {clientLifecycleStore} from './postgres-store.mts';
import {clientErrorReporter} from './error-reporting.mts';
import {runLifecyclePass} from './pass.mts';
import {testMessageConfig} from './message-config.test-helper.mts';
const port=Number(process.env.CLIENTS_LOCAL_TEST_PORT);
test('durable error limits on real artificial PostgreSQL, with no Telegram', {skip:!port},async t=>{
  assert.equal(process.env.CLIENTS_LOCAL_TEST_HOST,'127.0.0.1');assert(port>=1024&&port<=65535);
  const {Pool}=createRequire(import.meta.url)('pg');
  const pool=new Pool({host:'127.0.0.1',port,user:'postgres',database:'unicorn_noco_copy_restore',max:8});
  const create=()=>clientLifecycleStore(pool,'unicorn_noco_copy_restore');
  const now=new Date('2026-10-21T16:00Z');
  const reset=async()=>{
    await pool.query(`TRUNCATE noco.client_notifications,noco.client_notification_days,noco.client_notification_events,noco.client_status_history RESTART IDENTITY;
      UPDATE noco.clients SET client_status='studying',client_role='фейк';
      UPDATE noco.clients SET client_role='ученик',telegram_personal_chat_id='@student',telegram_general_chat_id='-100111',
       google_folder='https://example.invalid',tg_hard_mentor='@mentor',market_id=1,stop_list_company=NULL WHERE id=1;
      INSERT INTO noco.client_notification_state VALUES(true,'2026-09-01',0)
       ON CONFLICT(singleton) DO UPDATE SET activated_at=excluded.activated_at,status_cursor=0`);
  };
  try {
    await reset();
    await t.test('concurrent claims and restarts produce one diagnostic, including a lost report acknowledgement',async()=>{
      await reset();
      const tasks=await Promise.all(Array.from({length:8},()=>create().delivery.claimReport!('report-key',1,['-100111','chat_not_found'],now)));
      assert.equal(tasks.filter(Boolean).length,1);
      assert.equal(await create().delivery.claimReport!('report-key',1,['-100111','chat_not_found'],new Date(now.getTime()+86399999)),false);
      assert.equal(await create().delivery.claimReport!('report-key',1,['-100111','chat_not_found'],new Date(now.getTime()+86400000)),true);
    });
    await t.test('missing-data alerts share one per-student limit across events and fields',async()=>{
      await reset();const s=create().delivery;
      const attempts=await Promise.all(['error:status:1','error:status:2'].map(k=>s.claim(k,1,'support_error',['TG ментора'],now,'studying')));
      assert.equal(attempts.filter(x=>x===true).length,1);
      const key=attempts[0]===true?'error:status:1':'error:status:2';
      await s.finish(key,{outcome:'sent',messageId:1});
      await pool.query('UPDATE noco.client_notifications SET sent_at=$1 WHERE event_key=$2',[now,key]);
      assert.equal(await create().delivery.claim('error:new-fields',1,'support_error',['Группа'],new Date(now.getTime()+86399999),'studying'),false);
      assert.equal(await create().delivery.claim(key,1,'support_error',['Группа'],new Date(now.getTime()+86400000),'studying'),true);
      assert.equal(await create().delivery.claim(key,1,'support_error',['Группа'],new Date(now.getTime()+86400001),'studying'),false,'A restart after the new claim must not reuse yesterday\'s sent_at');
      assert.equal(await create().delivery.claim('error:parallel',1,'support_error',['Другие поля'],new Date(now.getTime()+86400001),'studying'),false);
      await create().delivery.finish(key,{outcome:'uncertain',code:'transport'});
      assert.equal(await create().delivery.claim('error:another',1,'support_error',['Новые поля'],new Date(now.getTime()+86400001),'studying'),false);
    });
    await t.test('chat not found closes the daily check without endless attempts; a changed destination is not blocked',async()=>{
      await reset();const s=create();const row=(await s.clients()).find(r=>r.client.id===1)!;
      const report={sourceChatId:row.client.chatId,context:{clientId:1,clientName:row.client.name,chatPurpose:'Общий чат ученика'},
        result:{kind:'telegram-response' as const,response:{ok:false as const,error_code:400,description:'Bad Request: chat not found'}}};
      let reports=0;
      await clientErrorReporter(s.delivery,()=>now)(report,async()=>({kind:'telegram-response',response:{ok:true,result:{message_id:++reports,date:1,chat:{id:-900,type:'supergroup',title:'Reports'},text:'report'}}}));
      assert.equal(await s.delivery.claim('new-reminder',1,'reminder',[],now,'studying',row.client),true);
      await s.delivery.finish('new-reminder',{outcome:'failed',code:'telegram_400'});
      assert.equal(await s.delivery.claim('new-reminder',1,'reminder',[],now,'studying',row.client),'blocked');
      await pool.query(`INSERT INTO noco.client_notifications(event_key,client_id,kind,points,attempted_at,outcome,error_code)
        VALUES('reminder:1:baseline:2026-10-21',1,'reminder','[]',$1,'failed','telegram_400')`,[now]);
      let sends=0;
      await runLifecyclePass({store:s,send:async()=>{sends++;return {outcome:'sent',messageId:2}},messageConfig:testMessageConfig,supportChatId:'-900',now,apply:true,statuses:true,reminders:true});
      assert.equal(sends,0);assert.equal(await s.pendingDay(),null);
      await pool.query("UPDATE noco.clients SET telegram_general_chat_id='-100222' WHERE id=1");
      const changed=(await create().clients()).find(r=>r.client.id===1)!;
      assert.equal(await create().delivery.claim('changed-target',1,'reminder',[],now,'studying',changed.client),true);
      assert.equal(reports,1);
    });
    await t.test('an unavailable chat never marks the status event delivered or consumes it',async()=>{
      await reset();await pool.query("UPDATE noco.clients SET client_status='hh_ru process' WHERE id=1");
      await pool.query("INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(1,'studying','hh_ru process',$1)",[now]);
      await create().delivery.claimReport!('blocked-target',1,['-100111','forbidden'],now);
      const id=(await pool.query('SELECT max(id)::text AS id FROM noco.client_status_history')).rows[0].id;
      await pool.query(`INSERT INTO noco.client_notifications(event_key,client_id,kind,points,attempted_at,outcome,error_code)
        VALUES($1,1,'hh_ru process','[]',$2,'failed','telegram_403')`,['status:'+id,now]);
      let sends=0;
      await runLifecyclePass({store:create(),send:async()=>{sends++;return {outcome:'sent',messageId:2}},messageConfig:testMessageConfig,supportChatId:'-900',now,apply:true,statuses:true,reminders:false});
      assert.equal(sends,0);
      const events=(await pool.query('SELECT done,retry_at FROM noco.client_notification_events')).rows;
      assert.equal(events.length,1);assert.equal(events[0].done,false);
      assert.equal(new Date(events[0].retry_at).getTime(),now.getTime()+86400000);
    });
  } finally {await pool.end()}
});
