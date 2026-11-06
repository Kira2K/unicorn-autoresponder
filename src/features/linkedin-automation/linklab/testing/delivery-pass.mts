/** Isolated acceptance only: refuses all non-loopback transports and databases. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createAccountDeliveryWorker} from '../crm-account-delivery.mts';

assert.equal(process.env.CRM_BINDING_TEST_PORT,'45528');
const origin=new URL(process.env.CRM_BINDING_TEST_URL!);
assert.equal(origin.protocol,'http:');assert.equal(origin.hostname,'127.0.0.1');
const {Pool}=createRequire(import.meta.url)('pg');
const realPool=new Pool({host:'127.0.0.1',port:45528,user:'binding_synthetic',database:'unicorn_noco_copy_restore',max:2});
const mode=process.env.CRM_BINDING_TEST_MODE||'normal';
assert.ok(['normal','lost-reply','lost-finish-commit','transient-busy'].includes(mode));
let injected=false;
const pool=mode==='lost-finish-commit'?{end:()=>realPool.end(),connect:async()=>{
  const session=await realPool.connect();let finishing=false;
  return{release:(destroy?:boolean)=>session.release(destroy),query:async(sql:string,params?:unknown[])=>{
    const result=await session.query(sql,params);
    if(sql.startsWith('SELECT noco.crm_finish_account_delivery('))finishing=true;
    if(sql==='COMMIT'&&finishing&&!injected){injected=true;throw Error('synthetic lost COMMIT reply');}
    return result;
  }};
}}:realPool;
let calls=0;
const bodies:string[]=[];
const statuses:number[]=[];
const transport:typeof fetch=async(url,init)=>{
  const target=new URL(String(url));
  assert.equal(target.origin,'https://synthetic-crm.invalid');
  calls++;
  bodies.push(Buffer.from(init!.body as Uint8Array).toString('utf8'));
  const reply=await fetch(new URL(target.pathname,origin),init);
  statuses.push(reply.status);
  if(mode==='lost-reply'&&calls===1){await reply.arrayBuffer();throw Error('synthetic lost HTTP reply after server COMMIT');}
  return reply;
};
try{
  const worker=createAccountDeliveryWorker({pool,database:'unicorn_noco_copy_restore',config:{baseUrl:'https://synthetic-crm.invalid',secret:process.env.CRM_BINDING_TEST_SECRET!},fetch:transport});
  await worker.checkSchema();
  if(mode==='lost-finish-commit')await assert.rejects(worker.pass(),{code:'commit_uncertain'});
  else await worker.pass();
  if(mode==='transient-busy'){
    const saved=(await realPool.query('SELECT state,error_code,acknowledged_at FROM noco.crm_account_deliveries')).rows[0];
    assert.equal(saved.state,'pending');assert.equal(saved.error_code,'crm_account_command_http_503');assert.equal(saved.acknowledged_at,null);
  }
  if(mode==='lost-reply'||mode==='transient-busy')await realPool.query("UPDATE noco.crm_account_deliveries SET available_at=clock_timestamp()-interval '1 second'");
  await worker.pass();await worker.stop();
  assert.equal(calls,mode==='lost-reply'||mode==='transient-busy'?2:1);
  if(mode==='transient-busy')assert.deepEqual(statuses,[503,201]);
  if(calls===2)assert.equal(bodies[0],bodies[1]);
}finally{await pool.end();}
