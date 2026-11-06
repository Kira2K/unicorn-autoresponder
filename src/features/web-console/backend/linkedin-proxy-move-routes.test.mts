import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {ProxyMoveService} from '../../linkedin-automation/proxy-move/service.mts';
const require=createRequire(import.meta.url),express=require('express') as typeof import('express');
const {registerProxyMoveRoutes}=require('./linkedin-proxy-move-routes.ts') as typeof import('./linkedin-proxy-move-routes.ts');
test('proxy move derives owner from session, denies staff and hides private failure diagnostics',async()=>{
  const app=express();app.use(express.json());let role='client',failure:unknown,args:unknown[]=[];
  const service={async replace(...a:unknown[]){if(failure)throw failure;args=a;return{queued:true};}} as unknown as ProxyMoveService;
  registerProxyMoveRoutes(app,(req:any,_res,next)=>{req.webSession={role,clientId:901};next();},service);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(done=>server.once('listening',done));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/client/linkedin-proxy-move/proxy`;
  const body={clientId:999,profileId:999,password:'private'},send=()=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    for(role of ['admin','linkedin_creator','provider'])assert.equal((await send()).status,403);
    role='client';const response=await send();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(args,[901,body]);
    failure=Object.assign(Error('password=private'),{code:'postgres_failed'});assert.deepEqual(await(await send()).json(),{error:'linkedin_proxy_move_unavailable'});
    failure=Object.assign(Error('private'),{code:'commit_uncertain'});assert.equal((await send()).status,503);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
});
