import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {createPostgresPool} from './pg-pool.mts';
import {createReadSession} from './read-session.mts';import {writeTransaction} from './working-session.mts';
import {COPY_MARKER} from './contracts.mts';
const config={host:'127.0.0.1',port:5432,database:'unicorn_noco_copy' as const,user:'test',password:'fake'};
function fixture(failAt:string){
 const error=Object.assign(new Error('Connection terminated unexpectedly'),{code:'ECONNRESET'}),calls:string[]=[],releases:boolean[]=[];
 class Client extends EventEmitter {
  async query(text:string){calls.push(text);if(text===failAt){this.emit('error',error);throw error;}
   return {rows:text.includes('current_database()')?[{database:config.database,marker:COPY_MARKER}]:[]};}
  release(destroy=false){releases.push(destroy);}
 }
 const clients:Client[]=[];class Pool extends EventEmitter{async connect(){const c=new Client();clients.push(c);return c;}async end(){}}
 const notices:string[]=[],pool=createPostgresPool(config,e=>notices.push(e.code),Pool);
 return {pool,clients,calls,releases,notices,error};
}
test('active connection error is handled and discarded without replay',async()=>{
 const f=fixture('SELECT value');const read=createReadSession(f.pool,config.database);
 await assert.rejects(read(s=>s.query('SELECT value')),{code:'postgres_read_unavailable'});
 assert.deepEqual(f.notices,['postgres_connection_failed']);assert.deepEqual(f.releases,[true]);
 assert.equal(f.calls.filter(x=>x==='SELECT value').length,1);assert.equal(f.clients[0].listenerCount('error'),0);
 await read(s=>s.query('SELECT next'));assert.equal(f.clients.length,2);assert.deepEqual(f.releases,[true,false]);await f.pool.end();
});
for(const [failAt,code]of [['UPDATE value','postgres_write_failed'],['COMMIT','commit_uncertain']] as const){
 test('active error preserves '+code,async()=>{const f=fixture(failAt);
  await assert.rejects(writeTransaction(f.pool,config.database,s=>s.query('UPDATE value')),{code});
  assert.equal(f.calls.filter(x=>x==='UPDATE value').length,1);assert.equal(f.calls.filter(x=>x==='COMMIT').length,failAt==='COMMIT'?1:0);
  assert.deepEqual(f.notices,['postgres_connection_failed']);assert.deepEqual(f.releases,[true]);await f.pool.end();
 });
}
test('connection error between queries prevents another request and destroys client',async()=>{
 const f=fixture('never'),s=await f.pool.connect();assert.doesNotThrow(()=>f.clients[0].emit('error',f.error));
 await assert.rejects(s.query('DO NOT SEND'),{code:'ECONNRESET'});assert.deepEqual(f.calls,[]);s.release();assert.deepEqual(f.releases,[true]);await f.pool.end();
});
