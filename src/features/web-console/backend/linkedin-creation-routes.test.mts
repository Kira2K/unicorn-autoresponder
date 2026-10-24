import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { CreationTaskService } from '../../linkedin-automation/creation-tasks/service.mts';
const require=createRequire(import.meta.url);
const {createWebConsoleApp,PROVIDER_LOGIN,PROVIDER_PASSWORD,CLIENT_PASSWORD}=require('./app.ts');
test('contractor login is isolated from Nariman and student APIs; task errors and secrets use safe responses',async()=>{
  let error:unknown;
  const creator={list:async()=>{if(error)throw error;return[{id:1}];},key:()=>({key:'test-key-only'})} as unknown as CreationTaskService;
  const app=createWebConsoleApp({useMockData:true,linkedinCreator:creator,linkedinCreatorAuth:{login:'test-creator',password:'test-password'}});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  async function login(email:string,password:string) {
    const res=await fetch(url+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    assert.equal(res.status,200);return{session:await res.json(),cookie:res.headers.get('set-cookie')!.split(';')[0]};
  }
  try{
    assert.equal((await fetch(url+'/api/linkedin-creator/tasks')).status,401);
    const c=await login('test-creator','test-password');assert.equal(c.session.role,'linkedin_creator');
    const get=(path:string)=>fetch(url+path,{headers:{cookie:c.cookie}});
    assert.deepEqual(await(await get('/api/linkedin-creator/tasks')).json(),[{id:1}]);
    for(const path of ['/api/provider/clients','/api/client/me','/api/admin/latest-client','/api/dolphin/profiles/status','/api/octo/profiles/status','/api/client/linkedin-intake','/api/profile-filler/status','/api/linkedin/auth/status'])
      assert.equal((await get(path)).status,403,path);
    assert.equal((await get('/api/auth/me')).status,200);
    const key=await fetch(url+'/api/linkedin-creator/nodemaven-key',{method:'POST',headers:{cookie:c.cookie}});
    assert.equal(key.headers.get('cache-control'),'no-store');assert.deepEqual(await key.json(),{key:'test-key-only'});
    error=Object.assign(Error('password=secret'),{code:'unexpected_upstream'});
    assert.deepEqual(await(await get('/api/linkedin-creator/tasks')).json(),{error:'linkedin_task_unavailable'});
    const p=await login(PROVIDER_LOGIN,PROVIDER_PASSWORD);assert.equal(p.session.role,'provider');
    assert.equal((await fetch(url+'/api/provider/clients',{headers:{cookie:p.cookie}})).status,200);
    assert.equal((await fetch(url+'/api/linkedin-creator/tasks',{headers:{cookie:p.cookie}})).status,403);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
