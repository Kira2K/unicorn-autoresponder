import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createRequire}from'node:module';
import{markConsoleAccountCreation}from'./crm-sync.mts';
const{Client}=createRequire(import.meta.url)('pg'),file=process.env.LINKEDIN_CYCLE_ISOLATED_CONFIG;
test('isolated PostgreSQL: old rows false, only new Console LinkedIn true, explicit reset and rerun preserved',{skip:!file},async()=>{
 const cfg=JSON.parse(readFileSync(file!,'utf8'));assert.equal(cfg.local_proof,true);assert.equal(cfg.host,'127.0.0.1');assert.equal(cfg.port,55439);assert.equal(cfg.database,'unicorn_noco_copy_restore');assert.equal(cfg.user,'cycle_owner');
 const db=new Client(cfg);await db.connect();const q=(sql:string,v:unknown[]=[])=>db.query(sql,v),migration=readFileSync(new URL('./sql/003-crm-sync-flag.up.sql',import.meta.url),'utf8');let owned=false;
 try{
  assert.equal((await q("SELECT to_regnamespace('noco') AS ns")).rows[0].ns,null,'never erase or reuse an existing schema');
  await q('CREATE SCHEMA noco');owned=true;
  await q(`CREATE TABLE noco.platforms(id bigint PRIMARY KEY,name text);INSERT INTO noco.platforms VALUES(16,'LinkedIn'),(31,'email_outlook'),(25,'hh.ru');
   CREATE TABLE noco.platform_accounts(id bigint PRIMARY KEY,platforms_id bigint REFERENCES noco.platforms(id),login text,__nc_deleted boolean DEFAULT false,is_banned boolean DEFAULT false);
   INSERT INTO noco.platform_accounts(id,platforms_id,login,__nc_deleted,is_banned) VALUES(1,16,'old',false,false),(2,16,'archived',true,true),(3,31,'mail',false,false);`);
  await q('BEGIN');await q(migration);assert.ok((await q('SELECT "isUnsyncedWithCRM" AS flag FROM noco.platform_accounts')).rows.every((r:any)=>r.flag===false));await q('ROLLBACK');
  assert.equal((await q("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='noco' AND table_name='platform_accounts' AND column_name='isUnsyncedWithCRM'")).rows[0].n,0);
  await q(migration);await q(migration);
  const insert=async(id:number,platform:number,console:boolean,rollback=false)=>{await q('BEGIN');try{if(console)await markConsoleAccountCreation(db);await q('INSERT INTO noco.platform_accounts(id,platforms_id,login) VALUES($1,$2,$3)',[id,platform,'synthetic']);await q(rollback?'ROLLBACK':'COMMIT');}catch(e){await q('ROLLBACK');throw e;}};
  await insert(11,16,true);await insert(12,31,true);await insert(13,25,true);await insert(14,16,false);await insert(15,16,true,true);await insert(16,16,false);
  assert.deepEqual((await q('SELECT id,"isUnsyncedWithCRM" AS flag FROM noco.platform_accounts ORDER BY id')).rows.map((r:any)=>[r.id,r.flag]),[['1',false],['2',false],['3',false],['11',true],['12',false],['13',false],['14',false],['16',false]]);
  await q("UPDATE noco.platform_accounts SET login='edited',is_banned=true,__nc_deleted=true WHERE id=11");assert.equal((await q('SELECT "isUnsyncedWithCRM" AS flag FROM noco.platform_accounts WHERE id=11')).rows[0].flag,true);
  await q('UPDATE noco.platform_accounts SET "isUnsyncedWithCRM"=false WHERE id=11');await q("UPDATE noco.platform_accounts SET login='edited-again',is_banned=false WHERE id=11");await q(migration);
  assert.equal((await q('SELECT "isUnsyncedWithCRM" AS flag FROM noco.platform_accounts WHERE id=11')).rows[0].flag,false);
  await insert(17,16,true);assert.equal((await q('SELECT "isUnsyncedWithCRM" AS flag FROM noco.platform_accounts WHERE id=17')).rows[0].flag,true);
  await q('BEGIN');await markConsoleAccountCreation(db);await q('INSERT INTO noco.platform_accounts(id,platforms_id,"isUnsyncedWithCRM") VALUES(18,16,false)');await q('COMMIT');assert.equal((await q('SELECT "isUnsyncedWithCRM" AS flag FROM noco.platform_accounts WHERE id=18')).rows[0].flag,true,'Console cannot claim CRM synchronization at creation');
 }finally{await q('ROLLBACK');if(owned)await q('DROP SCHEMA noco CASCADE');await db.end();}
});
