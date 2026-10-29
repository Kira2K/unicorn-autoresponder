import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {CreationTaskService} from '../../linkedin-automation/creation-tasks/service.mts';
const require=createRequire(import.meta.url),express=require('express') as typeof import('express');
const {registerAdminCreationTaskRoutes}=require('./linkedin-admin-creation-routes.ts') as typeof import('./linkedin-admin-creation-routes.ts');
test('only main admin can list, inspect and confirm tasks; notification state is separate and failures are sanitized',async()=>{
 let role='client',confirms=0,error:any;
 const service={notificationConfig:()=>({notificationMention:'@KiraSamsonova'}),adminList:async()=>[{id:1,status:'сделана экспертом'}],adminDetail:async()=>({task:{id:1}}),
  confirm:async(id:unknown,body:any)=>{if(error)throw error;assert.equal(id,'1');assert.equal(body.version,2);confirms++;return{task:{id:1,status:'выполнение подтверждено'},notification:{state:'pending'}};}} as unknown as CreationTaskService;
 const app=express();app.use(express.json());
 registerAdminCreationTaskRoutes(app,(req:any,_res,next)=>{req.webSession={role};next();},service);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/admin/linkedin-creation/tasks`;
 const confirm=()=>fetch(url+'/1/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:2})});
 try{
  for(const denied of ['client','provider','linkedin_creator']){role=denied;assert.equal((await fetch(url)).status,403);assert.equal((await confirm()).status,403);assert.equal((await fetch(url.replace('/tasks','/config'))).status,403);}
  assert.equal(confirms,0);role='admin';
  assert.deepEqual(await(await fetch(url.replace('/tasks','/config'))).json(),{notificationMention:'@KiraSamsonova'});
  const list=await fetch(url);assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).length,1);
  const accepted=await confirm();assert.equal(accepted.status,200);assert.equal((await accepted.json()).notification.state,'pending');assert.equal(confirms,1);
  error=Object.assign(Error('private database credentials'),{code:'unexpected_database_failure'});
  assert.deepEqual(await(await confirm()).json(),{error:'linkedin_task_unavailable'});
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
