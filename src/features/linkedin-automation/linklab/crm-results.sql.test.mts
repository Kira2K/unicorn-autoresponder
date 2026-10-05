import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const { Client } = createRequire(import.meta.url)('pg');
const configPath = process.env.LINKLAB_ISOLATED_PG_CONFIG;
const migration = (name: string) => readFileSync(new URL(`./sql/${name}.sql`, import.meta.url), 'utf8');

test('CRM results and proxy SQL contract on isolated PostgreSQL', {skip: !configPath}, async t => {
  const cfg=JSON.parse(readFileSync(configPath!, 'utf8'));
  assert.equal(cfg.local_proof,true);
  assert.equal(cfg.host,'127.0.0.1');
  assert.match(cfg.target_database,/^linklab_unicorn_test_[a-f0-9]{12}$/);
  const connect=async()=>{
    const db=new Client({...cfg,database:cfg.target_database,connectionTimeoutMillis:5000});
    await db.connect(); return db;
  };
  const db=await connect();
  const q=(s:string,p:unknown[]=[])=>db.query(s,p);
  const row=async()=> (await q('SELECT * FROM noco.linklab WHERE client_id=1')).rows[0];
  const student=randomUUID();
  const profile=(revision=1,filled=5,first:string|null=null)=>({revision,filled_count:filled,
    total_count:21,percent:Math.round(filled*100/21),first_completed_at:first});
  const send=(payload:any,operation=randomUUID(),kind='profile_progress',who=student)=>
    q('SELECT noco.linklab_apply_crm_result($1,1,$2,$3,$4) AS outcome',[operation,who,kind,JSON.stringify(payload)]);
  const rejects=async(action:()=>Promise<unknown>,pattern:RegExp)=>{
    await assert.rejects(action(),pattern); await q('ROLLBACK');
  };
  let owned=false;
  try {
    assert.equal((await q("SELECT to_regnamespace('noco') AS n")).rows[0].n,null);
    await q(`CREATE SCHEMA noco;
      CREATE TABLE noco.clients(id bigint PRIMARY KEY,client_name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text,__nc_deleted boolean DEFAULT false);
      CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,clients_id bigint,platforms_id bigint,__nc_deleted boolean DEFAULT false);
      INSERT INTO noco.clients VALUES(1,'Тест',false);
      INSERT INTO noco.platforms VALUES(16,'LinkedIn',false);
      INSERT INTO noco.platform_accounts VALUES(11,1,16,false);`);
    owned=true;
    await q(migration('001-status.up'));
    await q(`CREATE ROLE linklab_result_noco;
      GRANT USAGE ON SCHEMA noco TO linklab_result_noco;
      GRANT SELECT ON noco.linklab_pending_changes TO linklab_result_noco;`);
    await t.test('up/down preserves old view privileges and original data', async()=>{
      const before=(await q('SELECT * FROM noco.clients')).rows;
      await q(migration('002-crm-results.up'));
      await q(migration('002-crm-results.down'));
      assert.deepEqual((await q('SELECT * FROM noco.clients')).rows,before);
      assert.equal((await q("SELECT has_table_privilege('linklab_result_noco','noco.linklab_pending_changes','SELECT') AS p")).rows[0].p,true);
      await q(migration('002-crm-results.up'));
      await q("INSERT INTO noco.linklab(client_id,platform_account_id) VALUES(1,11)");
      const event=(await q('SELECT id FROM noco.linklab_changes')).rows[0];
      await q('SELECT noco.linklab_acknowledge($1,$2,$3)',[event.id,student,randomUUID()]);
      assert.equal((await row()).profile_percent,null);
    });
    await t.test('profile reply is ordered and lost responses replay without overwrite', async()=>{
      const op=randomUUID(),payload=profile();
      assert.equal((await send(payload,op)).rows[0].outcome,'applied');
      assert.equal((await send(payload,op)).rows[0].outcome,'duplicate');
      await rejects(()=>send(profile(1,10),op),/operation_conflict/);
      await rejects(()=>send(profile(1,10)),/revision_conflict/);
      await rejects(()=>send(profile(2),undefined,undefined,randomUUID()),/binding_conflict/);
      await send(profile(3,10));
      assert.equal((await send(profile(2,0))).rows[0].outcome,'stale');
      assert.equal((await row()).profile_percent,48);
      assert.equal((await row()).version,'1');
    });
    await t.test('invalid count, percent, nulls and first-date changes are rejected', async()=>{
      for(const payload of [profile(4,22),{...profile(4),percent:100},{...profile(4),revision:null},{}]) {
        await rejects(()=>send(payload),/profile_result_invalid/);
      }
      const first='2026-09-20T12:00:00Z';
      await send(profile(4,21,first));
      await send(profile(5,0,first));
      assert.equal((await row()).profile_first_completed_at.toISOString(),'2026-09-20T12:00:00.000Z');
      await rejects(()=>send(profile(6,21,null)),/first_date_conflict/);
    });
    await t.test('two result deliveries commit one receipt',async()=>{
      const other=await connect(),op=randomUUID(),payload=profile(6,21,'2026-09-20T12:00:00Z');
      try {
        const results=await Promise.all([send(payload,op),other.query(
          'SELECT noco.linklab_apply_crm_result($1,1,$2,$3,$4) AS outcome',[op,student,'profile_progress',JSON.stringify(payload)])]);
        assert.deepEqual(results.map(r=>r.rows[0].outcome).sort(),['applied','duplicate']);
      } finally { await other.end(); }
    });
    await t.test('restricted Noco can start one cycle but cannot end it or forge calculated fields',async()=>{
      await q(`GRANT SELECT ON noco.linklab TO linklab_result_noco;
        GRANT UPDATE(status,new_account_url,proxy_state) ON noco.linklab TO linklab_result_noco;
        SET ROLE linklab_result_noco;`);
      try {
        await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");
        const first=await row();
        await q("UPDATE noco.linklab SET proxy_state='Активна' WHERE client_id=1");
        assert.deepEqual(await row(),first);
        assert.equal(first.proxy_ends_at-first.proxy_started_at,48*3600*1000);
        await rejects(()=>q("UPDATE noco.linklab SET proxy_state='Не активна' WHERE client_id=1"),/completion_required/);
        for(const statement of ['UPDATE noco.linklab SET profile_revision=99','UPDATE noco.linklab SET proxy_completed_at=now()',
          'ALTER TABLE noco.linklab ADD COLUMN bad text', 'DELETE FROM noco.linklab']) {
          await rejects(()=>q(statement),/permission|owner/);
        }
        await rejects(()=>send(profile(7)),/permission/);
      } finally { await q('RESET ROLE'); }
      const event=(await q('SELECT * FROM noco.linklab_changes ORDER BY version DESC LIMIT 1')).rows[0];
      assert.deepEqual(event.changed_fields,['proxy_state']);
      assert.equal(event.proxy_cycle_id,(await row()).proxy_cycle_id);
    });
    await t.test('premature/wrong cycle completion cannot clear a pause',async()=>{
      const current=await row();
      // JS Date loses PostgreSQL microseconds; send the original precise timestamp.
      const end=(await q('SELECT proxy_ends_at::text AS value FROM noco.linklab WHERE client_id=1')).rows[0].value;
      await rejects(()=>send({cycle_id:randomUUID(),completed_at:end},undefined,'proxy_completed'),/result_conflict/);
      await rejects(()=>send({cycle_id:current.proxy_cycle_id,completed_at:end},undefined,'proxy_completed'),/not_finished/);
      assert.deepEqual(await row(),current);
    });
    await t.test('rollback with saved results is blocked without losing data',async()=>{
      const current=await row();
      await rejects(()=>q(migration('002-crm-results.down')),/results_exist/);
      assert.deepEqual(await row(),current);
    });
  } finally {
    await q('ROLLBACK'); await q('RESET ROLE');
    if(owned) {
      await q('DROP SCHEMA noco CASCADE');
      await q('DROP ROLE IF EXISTS linklab_result_noco');
    }
    await db.end();
  }
});
