import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

const {Client}=createRequire(import.meta.url)('pg');
const configPath=process.env.LINKLAB_ISOLATED_PG_CONFIG;
const migration=(name:string)=>readFileSync(new URL(`./sql/${name}.sql`,import.meta.url),'utf8');

test('temporary proxy status on isolated PostgreSQL', {skip:!configPath}, async t=>{
  const cfg=JSON.parse(readFileSync(configPath!,'utf8'));
  assert.equal(cfg.local_proof,true);
  assert.equal(cfg.host,'127.0.0.1');
  assert.match(cfg.target_database,/^linklab_unicorn_test_[a-f0-9]{12}$/);
  const db=new Client({...cfg,database:cfg.target_database,connectionTimeoutMillis:5000});
  await db.connect();
  const q=(text:string,values:unknown[]=[])=>db.query(text,values);
  const row=async()=> (await q('SELECT * FROM noco.linklab WHERE client_id=1')).rows[0];
  const student=randomUUID();
  const acknowledge=async()=>{
    const pending=(await q('SELECT id FROM noco.linklab_pending_changes WHERE client_id=1')).rows;
    for(const event of pending)await q('SELECT noco.linklab_acknowledge($1,$2,$3)',[event.id,student,randomUUID()]);
  };
  const complete=async()=>{
    // Test clock only: move the artificial cycle's deadline into the past.
    await q("UPDATE noco.linklab SET proxy_started_at=proxy_started_at-interval '49 hours', proxy_ends_at=proxy_ends_at-interval '49 hours' WHERE client_id=1");
    const end=(await q('SELECT proxy_ends_at::text AS value FROM noco.linklab WHERE client_id=1')).rows[0].value;
    const payload={cycle_id:(await row()).proxy_cycle_id,completed_at:end};
    const op=randomUUID();
    const send=()=>q("SELECT noco.linklab_apply_crm_result($1,1,$2,'proxy_completed',$3) AS outcome",[op,student,JSON.stringify(payload)]);
    assert.equal((await send()).rows[0].outcome,'applied');
    assert.equal((await send()).rows[0].outcome,'duplicate');
  };
  let owned=false;
  try{
    assert.equal((await q("SELECT to_regnamespace('noco') AS n")).rows[0].n,null);
    await q(`CREATE SCHEMA noco;
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint,platforms_id bigint,__nc_deleted boolean DEFAULT false);
      INSERT INTO noco.clients VALUES(1,'Искусственный',false),(2,'Контроль',false);
      INSERT INTO noco.platforms VALUES(16,'LinkedIn',false);
      INSERT INTO noco.platform_accounts VALUES(11,1,16,false),(12,2,16,false);`);
    owned=true;
    await q(migration('001-status.up'));await q(migration('002-crm-results.up'));
    await q("INSERT INTO noco.linklab(client_id,platform_account_id,status) VALUES(1,11,'Раскачка'),(2,12,'Новый')");
    await acknowledge();
    const control=(await q('SELECT * FROM noco.linklab WHERE client_id=2')).rows[0];
    await t.test('migration rolls back before use without replacing rows or privileges',async()=>{
      const before=await row();
      await q(migration('004-proxy-status.up'));await q(migration('004-proxy-status.down'));
      assert.deepEqual(await row(),before);
      await q(migration('004-proxy-status.up'));
      await q(`CREATE ROLE linklab_proxy_noco;
        GRANT USAGE ON SCHEMA noco TO linklab_proxy_noco;
        GRANT SELECT ON noco.linklab TO linklab_proxy_noco;
        GRANT UPDATE(status,new_account_url,proxy_state) ON noco.linklab TO linklab_proxy_noco;`);
    });
    await t.test('each original status returns after exactly 48h, repeats do not reset it',async()=>{
      for(const original of ['Новый','Прогрев','Раскачка','Пауза','Блок','Завершен']){
        await q('UPDATE noco.linklab SET status=$1 WHERE client_id=1',[original]);await acknowledge();
        const before=await row();
        await q('SET ROLE linklab_proxy_noco');
        try{
          await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");
          const paused=await row();
          assert.equal(paused.status,'Пауза');assert.equal(paused.proxy_previous_status,original);
          assert.equal(paused.proxy_status_overridden,false);
          assert.equal(paused.proxy_ends_at-paused.proxy_started_at,48*3600*1000);
          await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");
          assert.deepEqual(await row(),paused);
          await assert.rejects(q("UPDATE noco.linklab SET proxy_state='Не активна' WHERE client_id=1"),/completion_required/);
          await assert.rejects(q("UPDATE noco.linklab SET proxy_previous_status='Блок' WHERE client_id=1"),/permission/);
        }finally{await q('RESET ROLE');}
        await acknowledge();
        await complete();
        assert.equal((await row()).status,original);
        assert.deepEqual((await row()).blocked_at,before.blocked_at);
        await acknowledge();
        assert.equal((await row()).sync_state,'Готово');
      }
    });
    await t.test('manual Block and manual return to Pause both win over automatic restore',async()=>{
      for(const manual of ['Блок','Пауза']){
        await q("UPDATE noco.linklab SET status='Раскачка' WHERE client_id=1");await acknowledge();
        await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");await acknowledge();
        await q("UPDATE noco.linklab SET status='Блок' WHERE client_id=1");await acknowledge();
        await q('UPDATE noco.linklab SET status=$1 WHERE client_id=1',[manual]);await acknowledge();
        assert.equal((await row()).proxy_status_overridden,true);
        await complete();
        assert.equal((await row()).status,manual);
      }
    });
    await t.test('URL edit does not suppress restore and cancelled history cannot be discarded by rollback',async()=>{
      await q("UPDATE noco.linklab SET status='Прогрев' WHERE client_id=1");await acknowledge();
      await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");await acknowledge();
      await q("UPDATE noco.linklab SET new_account_url='https://example.invalid/new' WHERE client_id=1");await acknowledge();
      assert.equal((await row()).proxy_status_overridden,false);
      await complete();await acknowledge();
      assert.equal((await row()).status,'Прогрев');
      await assert.rejects(q(migration('004-proxy-status.down')),/export_before_rollback/);await q('ROLLBACK');
    });
    const after=(await q('SELECT * FROM noco.linklab WHERE client_id=2')).rows[0];
    for(const [key,value] of Object.entries(control))assert.deepEqual(after[key],value);
  }finally{
    await q('ROLLBACK');await q('RESET ROLE');
    if(owned){await q('DROP SCHEMA noco CASCADE');await q('DROP ROLE IF EXISTS linklab_proxy_noco');}
    await db.end();
  }
});
