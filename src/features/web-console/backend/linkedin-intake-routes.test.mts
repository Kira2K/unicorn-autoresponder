import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { LinkedInIntakeService } from '../../linkedin-automation/console-intake/service.mts';
const require = createRequire(import.meta.url), express = require('express') as typeof import('express');
const { registerLinkedInIntakeRoutes } = require('./linkedin-intake-routes.ts') as typeof import('./linkedin-intake-routes.ts');

test('ban cancellation is client-only, owner-scoped and preserves safe concurrency/uncertainty errors',async()=>{
 let role='client',error:unknown,args:unknown[]=[];
 const app=express();app.use(express.json());
 const service={async cancelBan(...values:unknown[]){if(error)throw error;args=values;return{cancelled:true,isBanned:false};}} as unknown as LinkedInIntakeService;
 registerLinkedInIntakeRoutes(app,(req:any,_res,next)=>{req.webSession={role,clientId:7};next();},service);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/client/linkedin-intake/ban`;
 const body={clientId:99,linkedinAccountId:42,banUndoVersion:'receipt-version'};
 const cancel=()=>fetch(url,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  for(role of ['admin','provider','linkedin_creator'])assert.equal((await cancel()).status,403);
  role='client';const result=await cancel();assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual(args,[7,body]);
  error=Object.assign(Error('private SQL diagnostics'),{code:'linkedin_intake_ban_changed'});
  assert.equal((await cancel()).status,409);assert.deepEqual(await(await cancel()).json(),{error:'linkedin_intake_ban_changed'});
  error=Object.assign(Error('private ack diagnostics'),{code:'commit_uncertain'});assert.equal((await cancel()).status,503);
 }finally{await new Promise<void>(done=>server.close(()=>done()));}
});
test('owner-scoped intake ignores supplied client ID, denies other roles, never returns upstream diagnostics', async () => {
  let role = 'client', error: unknown, savedId = 0;
  const app = express(); app.use(express.json());
  const service = { async load(id: number) { assert.equal(id, 7); return { url: '' }; },
    async save(id: number) { if (error) throw error; savedId = id; return { saved: true }; } } as unknown as LinkedInIntakeService;
  registerLinkedInIntakeRoutes(app, (req: any, _res, next) => { req.webSession = { role, clientId: 7 }; next(); }, service);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/client/linkedin-intake`;
  try {
    const get = await fetch(url); assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await get.json(), { url: '' });
    role = 'admin'; assert.equal((await fetch(url)).status, 403);
    role = 'provider'; assert.equal((await fetch(url)).status, 403);
    role = 'client';
    const put = () => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"clientId":99}' });
    assert.equal((await put()).status, 200); assert.equal(savedId, 7);
    error = Object.assign(new Error('database password=private'), { code: 'postgres_failed' });
    assert.deepEqual(await (await put()).json(), { error: 'linkedin_intake_unavailable' });
    error = Object.assign(new Error('unknown'), { code: 'commit_uncertain' });
    assert.deepEqual(await (await put()).json(), { error: 'commit_uncertain' });
    error=Object.assign(Error('private upstream'),{code:'octo_client_data_required',fields:[{field:'calendarEmail',label:'private value'},{field:'password',label:'private value'}]});
    assert.deepEqual(await(await put()).json(),{error:'octo_client_data_required',fields:[{field:'calendarEmail',label:'Личный email'}]});
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
