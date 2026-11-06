import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import type {SqlPool} from '../../../integrations/postgres/contracts.mts';
import {assertCopyDatabase} from '../../../integrations/postgres/read-session.mts';
import {assertFixture,fixtureEmail} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
import {createProxyMoveStore} from './postgres-store.mts';
import type {Move} from './contracts.mts';
import {createLinkedInIntakeStore} from '../console-intake/postgres-store.mts';
import {parseIntake} from '../console-intake/contracts.mts';
import {createCreationTaskStore} from '../creation-tasks/postgres-store.mts';
import {cycleNotificationStore} from '../creation-tasks/cycle-notifications.mts';
test('real SQL constraints accept atomic queue/completion; mailbox guard and all writes roll back', {skip:process.env.LINKEDIN_LOCAL_SQL_TEST!=='1'},async t=>{
  const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),s=await pool.connect(),runId=process.env.LINKEDIN_LOCAL_RUN_ID||'20261106-local';
  const id=randomUUID();
  try{
    await s.query('BEGIN READ WRITE');await assertCopyDatabase(s,config.database);
    const client=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(runId,'auto')])).rows[0];assertFixture(client,runId,'auto');
    if((await s.query('SELECT id FROM noco.linkedin_proxy_move WHERE client_id=$1',[client.id])).rows.length){t.skip('fixture already has a real move');return;}
    const accounts=(await s.query("SELECT a.* FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id WHERE a.clients_id=$1 AND lower(p.name)='linkedin' AND NOT coalesce(a.__nc_deleted,false)",[client.id])).rows;assert.equal(accounts.length,1);
    const account=accounts[0];await s.query("UPDATE noco.platform_accounts SET outlook_forwarding_confirmed_at='2026-01-01' WHERE id=$1",[account.id]);
    await s.query("UPDATE noco.clients SET ready_for_interview_in_english_in_2_months='Yes' WHERE id=$1",[client.id]);
    await s.query("UPDATE noco.platform_accounts SET login='changed-synthetic@example.invalid' WHERE id=$1",[account.id]);
    assert.equal((await s.query('SELECT outlook_forwarding_confirmed_at FROM noco.platform_accounts WHERE id=$1',[account.id])).rows[0].outlook_forwarding_confirmed_at,null);
    const p=(await s.query("SELECT state FROM noco.octo_profiles WHERE client_id=$1 AND locale='en'",[client.id])).rows[0]?.state as ManagedProfile;assert.ok(p?.uuid);
    // Keep the outer transaction open: service COMMIT/ROLLBACK cannot publish this fake queue to the worker.
    const isolated:SqlPool={async end(){},async connect(){return{release(){},async query(sql,values){if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return{rows:[]};
      try{return await s.query(sql,values);}catch(error){const e=error as {code?:string;constraint?:string;message?:string};console.error(JSON.stringify({sqlCode:e.code,constraint:e.constraint,
        domainCode:/^(linkedin_|linklab_|octo_)[a-z_]+$/.test(e.message||'')?e.message:undefined}));throw error;}
    }};}};
    const store=createProxyMoveStore(isolated,config.database),move:Move={id,clientId:Number(client.id),accountId:Number(account.id),profileId:p.id,profileUuid:p.uuid!,country:'ES',phase:'assigning',fingerprint:'synthetic',createdAt:new Date().toISOString()};
    await store.begin(move,p,{type:'socks5',host:'example.invalid',port:1080,login:'synthetic',password:'synthetic'});
    const queued=(await s.query('SELECT revision,state FROM noco.octo_profiles WHERE profile_id=$1',[p.id])).rows[0];
    assert.equal(Number(queued.revision),p.revision+1);assert.equal((queued.state as ManagedProfile).revision,Number(queued.revision));
    const assigned=queued.state as ManagedProfile;assigned.proxyChange={...assigned.proxyChange!,phase:'complete',uuid:randomUUID().replaceAll('-','')};assigned.proxy={uuid:assigned.proxyChange.uuid!,title:'synthetic'};assigned.revision++;
    await s.query('UPDATE noco.octo_profiles SET state=$2,revision=$3 WHERE profile_id=$1',[p.id,JSON.stringify(assigned),assigned.revision]);
    const complete=await store.finish(move,assigned,'2026-11-06T10:00:00Z');assert.equal(complete.pauseUntil,'2026-11-08T10:00:00.000Z');
    assert.equal((await store.finish(move,assigned,'2026-11-07T10:00:00Z')).completedAt,'2026-11-06T10:00:00Z');
    assert.equal((await s.query('SELECT notice_state FROM noco.linkedin_proxy_move WHERE id=$1',[id])).rows[0].notice_state,'pending');
    // Exercise local confirmation routing under the real cycle triggers, without ever committing or sending.
    const compatible=(await s.query("SELECT bool_or(pg_get_constraintdef(oid) LIKE '%сделана экспертом%' AND pg_get_constraintdef(oid) NOT LIKE '%выполнение подтверждено%') AS ready FROM pg_constraint WHERE conrelid='noco.linkedin_creation_task'::regclass AND contype='c'")).rows[0]?.ready===true;
    if(!compatible)t.diagnostic('Optional Denis completion requires the three-status schema. Move queue/completion and mailbox guard are exercised.');
    if(compatible&&!(await s.query('SELECT id FROM noco.linkedin_creation_task WHERE client_id=$1',[client.id])).rows.length){
      await s.query("UPDATE noco.platform_accounts SET url='',login='',password='' WHERE id=$1",[account.id]);
      const intake=createLinkedInIntakeStore(isolated,config.database,false,true,undefined,false);
      const saved=await intake.save(Number(client.id),parseIntake({scenario:'new',outlookForwardingConfirmed:true,outlookRegisteredAt:'2026-10-25T10:00:00.000Z',outlookLogin:'sql-fixture@outlook.com',outlookPassword:'synthetic',firstName:'Alex',lastName:'Test',realLocation:'Tbilisi'}),['en']);
      await s.query("UPDATE noco.platform_accounts SET url='https://linkedin.com/in/synthetic-sql-test',login='sql-fixture@outlook.com',password='synthetic' WHERE id=$1",[saved.linkedinAccountId]);
      await s.query('UPDATE noco.linkedin_creation_task SET requires_new_proxy=false,proxy_profile_id=$2,proxy_uuid=$3,proxy_saved_at=clock_timestamp() WHERE id=$1',[saved.task!.id,p.id,assigned.proxy!.uuid]);
      const ready=(await s.query('SELECT version FROM noco.linkedin_creation_task WHERE id=$1',[saved.task!.id])).rows[0];
      const tasks=createCreationTaskStore(isolated,config.database,false,undefined,[Number(client.id)]);
      await tasks.status(saved.task!.id,Number(ready.version),'сделана экспертом');
      const reserved=(await s.query('SELECT state,error_code FROM noco.linkedin_cycle_notifications WHERE task_id=$1',[saved.task!.id])).rows[0];
      assert.equal(reserved.state,'failed');assert.equal(reserved.error_code,'local_delivery_pending');
      assert.equal((await tasks.notification(saved.task!.id)).deliveries.length,2);
      const notices=cycleNotificationStore(isolated,config.database,[Number(client.id)]);
      const recipients=[];
      for(let index=0;index<2;index++){const claimed=await notices.claim();assert.equal(claimed?.taskId,saved.task!.id);assert.equal(claimed?.test,true);assert.equal(claimed?.chatId,'-5216637594');recipients.push(claimed!.recipient);await notices.finish(claimed!,'sent',12+index);}
      assert.deepEqual(recipients.sort(),['reports','student']);assert.equal(await notices.claim(),undefined);
      await tasks.status(saved.task!.id,Number(ready.version),'сделана экспертом');
      assert.ok((await tasks.notification(saved.task!.id)).deliveries.every(d=>d.state==='sent'));
    }
  }finally{await s.query('ROLLBACK');s.release();await pool.end();}
});
