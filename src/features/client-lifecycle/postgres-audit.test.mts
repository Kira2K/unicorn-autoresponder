import { testMessageConfig } from "./message-config.test-helper.mts";
/** Real artificial PostgreSQL. Loopback/port/marker guard; no external sender. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { clientLifecycleStore } from './postgres-store.mts';
import { planReminder, planStatusMessage } from './policy.ts';
import { deliverPlan } from './worker.ts';
import { runLifecyclePass } from './pass.mts';
import { createLifecycleRuntime } from './runtime.mts';

const port=Number(process.env.CLIENTS_LOCAL_TEST_PORT);
test('actual PostgreSQL notification contract', {skip:!port},async t=>{
  assert.equal(process.env.CLIENTS_LOCAL_TEST_HOST,'127.0.0.1');assert(port>=1024&&port<=65535);
  const {Pool}=createRequire(import.meta.url)('pg');
  const pool=new Pool({host:'127.0.0.1',port,user:'postgres',database:'unicorn_noco_copy_restore',max:5});
  const store=clientLifecycleStore(pool,'unicorn_noco_copy_restore');
  const now=new Date('2026-10-14T16:00:00Z');
  const activatedAt=new Date('2026-09-01T00:00:00Z');
  async function reset(){
    await pool.query(`TRUNCATE noco.client_notification_events,noco.client_notification_days,noco.client_notifications,noco.client_status_history RESTART IDENTITY;
      UPDATE noco.clients SET client_status='studying',client_role='ученик',market_id=2,__nc_deleted=false,
      telegram_personal_chat_id='@audit_student',telegram_general_chat_id='-1001111111111',
      google_folder='https://example.invalid/drive',tg_hard_mentor='@audit_mentor',first_name='First',last_name='Last',fio='First Last',
      birth_date='2000-01-01',english_levels_id=1,ready_for_interview_in_english_in_2_months='No',
      real_location='City',desired_location='Remote',calendar_email='synthetic@example.invalid',
      education=NULL,education_entries='[]',no_higher_education=true,stop_list_company='Company';
      INSERT INTO noco.client_notification_state VALUES(true,'2026-09-01T00:00:00Z',0)
      ON CONFLICT(singleton) DO UPDATE SET activated_at=excluded.activated_at,status_cursor=0`);
    await pool.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at)
      VALUES(1,'onboarding','studying','2026-09-02T00:00:00Z')`);
  }
  const row=async()=>(await store.clients()).find(r=>r.client.id===1)!;
  const reminder=async()=>{const r=await row();return planReminder(r.client,{now,activatedAt,...r})};
  try {
    await reset();
    await t.test('pg Date precision: a transition in the activation second sends once, including after restart',async()=>{
      await reset();
      await pool.query(`UPDATE noco.client_notification_state SET activated_at='2026-10-14T16:00:00.100Z';
        UPDATE noco.clients SET client_status='onboarding' WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at)
          VALUES(1,'studying','onboarding','2026-10-14T16:00:00.900Z')`);
      assert.equal((await store.activation())!.activatedAt.toISOString(),'2026-10-14T16:00:00.100Z');
      assert.equal((await store.changes('0'))[0].at.toISOString(),'2026-10-14T16:00:00.900Z');
      let sends=0;
      const options={store,messageConfig: testMessageConfig, supportChatId:'999',now:new Date('2026-10-14T16:00:01Z'),apply:true,statuses:true,reminders:false,
        send:async()=>({outcome:'sent' as const,messageId:++sends})};
      await runLifecyclePass(options);
      await runLifecyclePass({...options,store:clientLifecycleStore(pool,'unicorn_noco_copy_restore')});
      assert.equal(sends,1);
      assert.equal((await pool.query("SELECT count(*) FROM noco.client_notifications WHERE outcome='sent'")).rows[0].count,'1');
    });
    await t.test('pg Date precision: seven complete onboarding days, not one millisecond earlier',async()=>{
      await reset();
      await pool.query(`UPDATE noco.clients SET client_status='onboarding',stop_list_company=NULL WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at)
          VALUES(1,'studying','onboarding','2026-10-07T16:00:00.001Z')`);
      const r=await row();
      assert.equal(r.statusChangedAt!.toISOString(),'2026-10-07T16:00:00.001Z');
      assert.equal(planReminder(r.client,{...r,activatedAt,now}).kind,'skip');
      assert.equal(planReminder(r.client,{...r,activatedAt,now:new Date(now.getTime()+1)}).kind,'send');
    });
    await t.test('pg Date precision: both 48h clocks agree with the SQL delivery guard at the boundary',async()=>{
      for(const timer of ['sent','hh']){
        await reset();await pool.query('UPDATE noco.clients SET stop_list_company=NULL WHERE id=1');
        if(timer==='sent')await pool.query(`INSERT INTO noco.client_notifications
          (event_key,client_id,kind,attempted_at,sent_at,outcome,message_id)
          VALUES('previous',1,'reminder','2026-10-12T16:00:00.001Z','2026-10-12T16:00:00.001Z','sent',1)`);
        else await pool.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at)
          VALUES(1,'studying','hh_ru process','2026-10-12T16:00:00.001Z')`);
        const r=await row();const due=new Date('2026-10-14T16:00:00.001Z');
        assert.equal(planReminder(r.client,{...r,activatedAt,now}).kind,'skip');
        assert.equal(planReminder(r.client,{...r,activatedAt,now:due}).kind,'send');
        assert.notEqual(await store.delivery.claim('boundary',1,'reminder',[],now,'studying'),true);
        assert.equal(await store.delivery.claim('boundary',1,'reminder',[],due,'studying'),true);
      }
    });
    await reset();
    await t.test('source values and real NULLs: every personal field is detected; No/education flag are not empty',async()=>{
      const r=await row();assert.deepEqual(r.client.missingPersonal,[]);
      const fields=[['first_name','Имя'],['last_name','Фамилия'],['fio','ФИО полностью'],['birth_date','Дата рождения'],['english_levels_id','Уровень английского'],
        ['ready_for_interview_in_english_in_2_months','Готовность к собеседованию на английском'],['real_location','Реальная локация'],['desired_location','Желаемая локация'],['calendar_email','Личный email'],['telegram_personal_chat_id','Личный Telegram']] as const;
      for(const [name,label] of fields){await reset();await pool.query(`UPDATE noco.clients SET ${name}=NULL WHERE id=1`);assert.deepEqual((await row()).client.missingPersonal,[label])}
      for(const education of ["no_higher_education=false,education='University'",`no_higher_education=false,education_entries='[{"uni":"University"}]'`,"no_higher_education=true,education=NULL,education_entries='[]'"]){
        await reset();await pool.query(`UPDATE noco.clients SET ${education} WHERE id=1`);assert.ok(!(await row()).client.missingPersonal.includes('Образование'))}
      await reset();await pool.query(`UPDATE noco.clients SET no_higher_education=false WHERE id=1`);assert.ok((await row()).client.missingPersonal.includes('Образование'));
    });
    await t.test('double worker and restart cannot duplicate the same reminder',async()=>{
      await reset();let sends=0;const r=await row();r.client.missingStopList=true;
      const plan=planReminder(r.client,{now,activatedAt,...r});const input={client:r.client,plan,now,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>({outcome:'sent' as const,messageId:++sends})};
      await Promise.all([deliverPlan(input),deliverPlan(input)]);await deliverPlan({...input,store:clientLifecycleStore(pool,'unicorn_noco_copy_restore').delivery});
      assert.equal(sends,1);assert.equal((await pool.query("SELECT count(*) FROM noco.client_notifications WHERE outcome='sent'")).rows[0].count,'1');
    });
    await t.test('a failed reminder yesterday is not the last SENT reminder and cannot impose 48h cooldown',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET stop_list_company=NULL WHERE id=1`);
      await pool.query(`INSERT INTO noco.client_notifications(event_key,client_id,kind,attempted_at,outcome,error_code)
        VALUES('rejected-yesterday',1,'reminder','2026-10-13T16:00:00Z','failed','telegram_429')`);
      assert.equal((await reminder()).kind,'send');
    });
    await t.test('HH timer remains reset when student moves to on ru market before 48h expires',async()=>{
      await reset();await pool.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES
        (1,'studying','hh_ru process','2026-10-14T14:00:00Z'),(1,'hh_ru process','on ru market','2026-10-14T15:00:00Z');
        UPDATE noco.clients SET client_status='on ru market',stop_list_company=NULL WHERE id=1`);
      assert.equal((await reminder()).kind,'skip','Section 6.1 resets the student clock, not just the HH screen');
    });
    await t.test('last transition is read from history, never from import/update time',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding',stop_list_company=NULL WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(1,'studying','onboarding','2026-10-07T16:00:00Z')`);
      const r=await row();assert.equal(r.statusChangedAt!.toISOString(),'2026-10-07T16:00:00.000Z');assert.equal((await reminder()).kind,'send');
    });
    await t.test('missing HH status history does not invent an eligible date',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='hh_en process',stop_list_company=NULL WHERE id=1`);
      assert.equal((await reminder()).kind,'error');
    });
    await t.test('current-status guard suppresses delivery after moving to paused',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding' WHERE id=1`);const r=await row();
      const p=planStatusMessage(r.client,{id:'11',oldStatus:'studying',newStatus:'onboarding',at:now},activatedAt);
      await pool.query(`UPDATE noco.clients SET client_status='paused' WHERE id=1`);let sends=0;
      await deliverPlan({client:r.client,plan:p,now,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>({outcome:'sent' as const,messageId:++sends})});
      assert.equal(sends,0);
    });
    await t.test('role changed to referral after reading cannot result in an onboarding send',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding' WHERE id=1`);const r=await row();
      const p=planStatusMessage(r.client,{id:'12',oldStatus:'studying',newStatus:'onboarding',at:now},activatedAt);
      await pool.query(`UPDATE noco.clients SET client_role='реферал' WHERE id=1`);let sends=0;
      await deliverPlan({client:r.client,plan:p,now,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>({outcome:'sent' as const,messageId:++sends})});
      assert.equal(sends,0);
    });
    await t.test('changed chat/tag cannot deliver to the stale destination',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding' WHERE id=1`);const r=await row();
      const p=planStatusMessage(r.client,{id:'13',oldStatus:'studying',newStatus:'onboarding',at:now},activatedAt);
      await pool.query(`UPDATE noco.clients SET telegram_general_chat_id='-1002222222222',telegram_personal_chat_id='@other_student' WHERE id=1`);const destinations:string[]=[];
      await deliverPlan({client:r.client,plan:p,now,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',send:async dest=>{destinations.push(dest);return {outcome:'sent' as const,messageId:1}}});
      assert.ok(!destinations.includes('-1001111111111'));
    });
    await t.test('cursor cannot lose a transition committed after a higher allocated history ID',async()=>{
      await reset();await pool.query('TRUNCATE noco.client_status_history RESTART IDENTITY');
      const a=await pool.connect(),b=await pool.connect();let pending=false;
      try{
        await a.query('BEGIN');pending=true;
        await a.query("UPDATE noco.clients SET client_status='hh_ru process' WHERE id=1");
        const first=(await a.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(1,'studying','hh_ru process','2026-10-14T15:00:00Z') RETURNING id`)).rows[0].id;
        await b.query('BEGIN');
        await b.query("UPDATE noco.clients SET client_status='hh_en process' WHERE id=2");
        const second=(await b.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(2,'studying','hh_en process','2026-10-14T15:01:00Z') RETURNING id`)).rows[0].id;
        await b.query('COMMIT');
        const visible=await store.changes('0');assert.deepEqual(visible.map(c=>c.id),[String(second)]);
        await store.advanceCursor(String(second));await a.query('COMMIT');pending=false;
        const later=await store.changes((await store.activation())!.statusCursor);
        assert.ok(later.some(c=>c.id===String(first)),'A committed transition must not be skipped due to allocation/commit order');
      }finally{if(pending)await a.query('ROLLBACK');a.release();b.release()}
    });
    await t.test('48h journal uses actual sent time, not the beginning of a slow send',async()=>{
      await reset();const r=await row();const startedAt=new Date();let acceptedAt:Date|undefined;
      await deliverPlan({client:r.client,plan:{kind:'send',key:'slow-send',chatId:r.client.chatId,tag:r.client.tag,stage:'reminder',missing:['Стоп-лист компаний']},
        now:startedAt,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',send:async()=>{
          await new Promise(resolve=>setTimeout(resolve,50));acceptedAt=new Date();return {outcome:'sent' as const,messageId:1}}});
      assert.ok(acceptedAt!.getTime()>startedAt.getTime());
      const nextAt=new Date(startedAt.getTime()+48*3600000);
      assert.ok(nextAt.getTime()-acceptedAt!.getTime()<48*3600000);
      const allowed=await store.delivery.claim('too-early-next',1,'reminder',[],nextAt,'studying');
      assert.equal(allowed,false,'A real send delay must not shorten the minimum 48h since accepted delivery');
    });
    await t.test('a real locked first row cannot starve the 501st healthy student',async()=>{
      await reset();
      await pool.query(`INSERT INTO noco.clients(id,client_name,client_status,client_role,market_id,telegram_personal_chat_id,telegram_general_chat_id,google_folder,tg_hard_mentor)
        SELECT i,'Synthetic '||i,'onboarding','ученик',2,'@audit_student_'||i,'-1001111111111','https://example.invalid/folder','@audit_mentor'
        FROM generate_series(6,501) i ON CONFLICT(id) DO NOTHING;
        UPDATE noco.clients SET client_status='onboarding';
        TRUNCATE noco.client_status_history RESTART IDENTITY;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at)
          SELECT id,'studying','onboarding','2026-10-14T15:00:00Z' FROM noco.clients ORDER BY id`);
      const actor=await pool.connect();await actor.query('BEGIN');await actor.query('SELECT id FROM noco.clients WHERE id=1 FOR UPDATE');
      // Shorten only the test lock timeout, never a production timeout or shared service.
      const boundedPool={connect:async()=>{
        const session=await pool.connect();return {query:async(sql:string,values?:unknown[])=>{
          if(sql.includes('SELECT id FROM noco.clients WHERE'))await session.query("SET LOCAL lock_timeout='25ms'");
          return session.query(sql,values);
        },release:(destroy=false)=>session.release(destroy)}
      },end:async()=>{}};
      const boundedStore=clientLifecycleStore(boundedPool,'unicorn_noco_copy_restore');
      try{
        for(let i=0;i<3;i++)await runLifecyclePass({store:boundedStore,messageConfig: testMessageConfig, supportChatId:'999',now,apply:true,statuses:true,reminders:false,
          send:async()=>({outcome:'sent' as const,messageId:1})});
        const target=(await pool.query("SELECT event_key FROM noco.client_notifications WHERE event_key='status:501' AND outcome='sent'")).rows;
        assert.equal(target.length,1,'A real unrelated row lock repeatedly refetches page 1 and prevents delivery past 500');
      }finally{await actor.query('ROLLBACK');actor.release()}
    });
    await t.test('explicit 429 retries only when due and sends once after access recovers',async()=>{
      await reset();await pool.query("UPDATE noco.clients SET client_status='onboarding' WHERE id=1");
      const r=await row(),at=new Date();
      const plan=planStatusMessage(r.client,{id:'retry',oldStatus:'studying',newStatus:'onboarding',at},activatedAt);
      let attempts=0;
      const input={client:r.client,plan,now:at,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',
        send:async()=>++attempts===1 ? {outcome:'failed' as const,code:'telegram_429',retryAfterSeconds:120} : {outcome:'sent' as const,messageId:1}};
      assert.equal((await deliverPlan(input)).state,'failed');
      const due=new Date((await pool.query("SELECT retry_at FROM noco.client_notifications WHERE event_key='status:retry'")).rows[0].retry_at);
      assert(due.getTime()>=at.getTime()+120000);
      assert.equal((await deliverPlan({...input,now:new Date(due.getTime()-1)})).state,'deferred');assert.equal(attempts,1);
      await Promise.all([deliverPlan({...input,now:due}),deliverPlan({...input,now:due})]);
      await deliverPlan({...input,now:new Date(due.getTime()+1000)});assert.equal(attempts,2);
      assert.equal((await pool.query("SELECT outcome FROM noco.client_notifications WHERE event_key='status:retry'")).rows[0].outcome,'sent');
    });
    await t.test('missing-field alert cannot consume the status notification; correction resumes it once',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding',tg_hard_mentor=NULL WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(1,'studying','onboarding','2026-10-14T15:00:00Z')`);
      const chats:string[]=[],options={store,messageConfig: testMessageConfig, supportChatId:'999',now,apply:true,statuses:true,reminders:false,
        send:async(chat:string)=>{chats.push(chat);return {outcome:'sent' as const,messageId:chats.length}}};
      await runLifecyclePass(options);await runLifecyclePass({...options,now:new Date(now.getTime()+61000)});
      assert.deepEqual(chats,['999']);
      await pool.query("UPDATE noco.clients SET tg_hard_mentor='@audit_mentor' WHERE id=1");
      await runLifecyclePass({...options,now:new Date(now.getTime()+122000)});
      await runLifecyclePass({...options,now:new Date(now.getTime()+183000)});
      assert.deepEqual(chats,['999','-1001111111111']);
    });
    await t.test('both rapidly committed HH transitions persist separately, including after restart',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='hh_en process' WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES
        (1,'studying','hh_ru process','2026-10-14T14:00:00Z'),(1,'hh_ru process','hh_en process','2026-10-14T15:00:00Z')`);
      const messages:string[]=[],options={store,messageConfig: testMessageConfig, supportChatId:'999',now,apply:true,statuses:true,reminders:false,
        send:async(_chat:string,text:string)=>{messages.push(text);return {outcome:'sent' as const,messageId:messages.length}}};
      await runLifecyclePass(options);await runLifecyclePass({...options,store:clientLifecycleStore(pool,'unicorn_noco_copy_restore')});
      assert.equal(messages.length,2);assert.match(messages[0],/следующий этап/);assert.match(messages[1],/иностранный рынок/);
    });
    await t.test('HH timer reset is checked atomically even if the final current status has not changed',async()=>{
      await reset();const r=await row();r.client.missingStopList=true;
      const plan=planReminder(r.client,{now,activatedAt,...r});assert.equal(plan.kind,'send');
      await pool.query(`INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES
        (1,'studying','hh_ru process','2026-10-14T14:00:00Z'),(1,'hh_ru process','studying','2026-10-14T15:00:00Z')`);
      let sends=0;await deliverPlan({client:r.client,plan,now,enabled:true,store:store.delivery,messageConfig: testMessageConfig, supportChatId:'999',
        send:async()=>({outcome:'sent' as const,messageId:++sends})});assert.equal(sends,0);
    });
    await t.test('started daily check survives SQL failure and process restart without duplicate delivery',async()=>{
      await reset();await pool.query("UPDATE noco.clients SET stop_list_company=NULL WHERE id=1");
      await pool.query("UPDATE noco.clients SET client_role='фейк' WHERE id<>1");
      let sends=0;const finishDay=store.finishDay;
      // The normal pass intentionally schedules exactly 19:00 MSK. Seed a
      // fractional persisted timestamp to exercise the store's recovery contract.
      await store.beginDay(new Date(now.getTime()+123));
      store.finishDay=async()=>{throw Error('lost SQL connection after sends')};
      const options={store,messageConfig: testMessageConfig, supportChatId:'999',now:new Date(now.getTime()+123),apply:true,statuses:false,reminders:false,
        send:async()=>({outcome:'sent' as const,messageId:++sends})};
      try{
        await assert.rejects(runLifecyclePass(options));assert.equal(sends,1);
        assert.equal((await store.pendingDay())!.toISOString(),'2026-10-14T16:00:00.123Z');
      }finally{store.finishDay=finishDay}
      await runLifecyclePass({...options,store:clientLifecycleStore(pool,'unicorn_noco_copy_restore'),now:new Date('2026-10-14T17:01Z'),reminders:false});
      assert.equal(sends,1);assert.equal(await store.pendingDay(),null);
    });
    await t.test('new daily check is never created off-hour, but an already started failed check can recover',async()=>{
      await reset();await pool.query("UPDATE noco.clients SET stop_list_company=NULL WHERE id=1");
      await pool.query("UPDATE noco.clients SET client_role='фейк' WHERE id<>1");
      let attempts=0;const options={store,messageConfig: testMessageConfig, supportChatId:'999',now:new Date('2026-10-14T17:01Z'),apply:true,statuses:false,reminders:true,
        send:async()=>{attempts++;return {outcome:'failed' as const,code:'telegram_429',retryAfterSeconds:1}}};
      await runLifecyclePass(options);assert.equal(attempts,0);assert.equal(await store.pendingDay(),null);
      await runLifecyclePass({...options,now});assert.equal(attempts,1);assert.ok(await store.pendingDay());
      // Fixture time, not wall time: PostgreSQL keeps microseconds whereas Date
      // truncates them. Prove both sides of the first representable due instant.
      await pool.query(`UPDATE noco.client_notifications SET retry_at='2026-10-14T17:01:00.123456Z'
        WHERE client_id=1 AND kind='reminder' AND outcome='failed'`);
      await runLifecyclePass({...options,now:new Date('2026-10-14T17:01:00.123Z'),reminders:false});
      assert.equal(attempts,1);assert.ok(await store.pendingDay());
      await runLifecyclePass({...options,now:new Date('2026-10-14T17:01:00.124Z'),reminders:false,
        send:async()=>({outcome:'sent' as const,messageId:++attempts})});
      assert.equal(attempts,2);assert.equal(await store.pendingDay(),null);
    });
    await t.test('backend daily schedule survives restart against the real SQL journal without a second send',async()=>{
      await reset();
      await pool.query("UPDATE noco.clients SET stop_list_company=NULL WHERE id=1");
      await pool.query("UPDATE noco.clients SET client_role='фейк' WHERE id<>1");
      let sends=0;
      const sender=async()=>({outcome:'sent' as const,messageId:++sends});
      const firstStore=clientLifecycleStore(pool,'unicorn_noco_copy_restore');
      firstStore.finishDay=async()=>{throw Error('restart after deliveries before daily acknowledgement')};
      const create=(target:typeof store,clock:Date)=>createLifecycleRuntime({enabled:true,intervalMs:60000,
        now:()=>clock,report:()=>{},pass:({now,reminders,reminderAt})=>runLifecyclePass({
          store:target,messageConfig:testMessageConfig,supportChatId:'999',send:sender,
          now,reminders,reminderAt,apply:true,statuses:false})});
      const first=create(firstStore,now);
      try{await first.start()}finally{await first.stop()}
      assert.equal(sends,1);assert.ok(await store.pendingDay());
      const restarted=create(clientLifecycleStore(pool,'unicorn_noco_copy_restore'),new Date('2026-10-14T17:01Z'));
      try{await restarted.start()}finally{await restarted.stop()}
      assert.equal(sends,1);assert.equal(await store.pendingDay(),null);
      const sameDay=create(clientLifecycleStore(pool,'unicorn_noco_copy_restore'),new Date('2026-10-14T16:30Z'));
      try{await sameDay.start()}finally{await sameDay.stop()}
      assert.equal(sends,1);assert.equal(await store.pendingDay(),null);
    });
    await t.test('explicit bulk cutover suppresses migration backlog without deleting delivery history',async()=>{
      await reset();await pool.query(`UPDATE noco.clients SET client_status='onboarding' WHERE id=1;
        INSERT INTO noco.client_status_history(client_id,old_status,new_status,changed_at) VALUES(1,'studying','onboarding','2026-10-14T15:00:00Z')`);
      const cli=readFileSync(new URL('./cli.mts',import.meta.url),'utf8');
      const section=cli.slice(cli.indexOf('if (args.has("--cutover"))'));
      const cutoverSql=/INSERT INTO noco\.client_notification_state[\s\S]+?status_cursor=EXCLUDED.status_cursor/.exec(section)?.[0];assert.ok(cutoverSql);
      await pool.query(`INSERT INTO noco.client_notifications(event_key,client_id,kind,attempted_at,sent_at,outcome,message_id)
        VALUES('historic-delivery',1,'onboarding',now(),now(),'sent',123)`);
      await pool.query(cutoverSql);
      let deliveries=0;await runLifecyclePass({store,messageConfig: testMessageConfig, supportChatId:'999',now,apply:true,statuses:true,reminders:false,
        send:async()=>({outcome:'sent' as const,messageId:++deliveries})});
      assert.equal(deliveries,0);
      assert.equal((await pool.query("SELECT message_id FROM noco.client_notifications WHERE event_key='historic-delivery'")).rows[0].message_id,'123');
    });
  }finally{await pool.end()}
});
