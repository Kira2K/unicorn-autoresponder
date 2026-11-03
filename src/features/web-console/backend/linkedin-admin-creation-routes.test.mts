import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import type {CreationTaskService} from '../../linkedin-automation/creation-tasks/service.mts';
const require=createRequire(import.meta.url),express=require('express') as typeof import('express');
const {registerAdminCreationTaskRoutes}=require('./linkedin-admin-creation-routes.ts') as typeof import('./linkedin-admin-creation-routes.ts');
test('admin history is read-only; the separate confirmation endpoint is absent for every role',async()=>{
 let role='client',error:unknown;
 const service={notificationConfig:()=>({notificationMention:'@KiraSamsonova'}),adminList:async()=>{
  if(error)throw error;return[{id:1,status:'сделана экспертом'}];},adminDetail:async()=>({task:{id:1},notification:{deliveries:[]}})} as unknown as CreationTaskService;
 const app=express();app.use(express.json());
 registerAdminCreationTaskRoutes(app,(req:any,_res,next)=>{req.webSession={role};next();},service);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/admin/linkedin-creation/tasks`;
 try{
  for(const denied of ['client','provider','linkedin_creator']){role=denied;assert.equal((await fetch(url)).status,403);}
  for(const actor of ['client','provider','linkedin_creator','admin']){role=actor;assert.equal((await fetch(url+'/1/confirm',{method:'POST'})).status,404);}
  role='admin';const list=await fetch(url);assert.equal(list.headers.get('cache-control'),'no-store');assert.equal((await list.json()).length,1);
  assert.deepEqual((await(await fetch(url+'/1')).json()).notification,{deliveries:[]});
  error=Object.assign(Error('private database credentials'),{code:'unexpected_database_failure'});
  assert.deepEqual(await(await fetch(url)).json(),{error:'linkedin_task_unavailable'});
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
