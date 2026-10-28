import {createPostgresPool} from '../../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../../integrations/postgres/read-session.mts';
import {createCloudApi} from '../../../octo-access/cloud-api.mts';
import {createOctoApi} from '../../../octo-access-test/octo-api.mts';
export const consoleUrl='https://very-evil-unicorn.onrender.com';
export async function cycleContext(env:NodeJS.ProcessEnv){
 const render=async(path:string)=>{
  const r=await fetch(`https://api.render.com/v1/${path}`,{headers:{Authorization:`Bearer ${env.RENDER_API_KEY}`},signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('e2e_render_read_failed');return r.json();
 };
 const vars=Object.fromEntries((await render('services/srv-d8nnraok1i2s73dhp190/env-vars?limit=100')).map((x:any)=>[x.envVar.key,x.envVar.value])) as NodeJS.ProcessEnv;
 const config=readPostgresAppDbConfig(env),pool=createPostgresPool(config),read=createReadSession(pool,config.database);
 return{env,vars,config,pool,read,render,cloud:createCloudApi(vars.OCTO_API_TOKEN!),rawCloud:createOctoApi(vars.OCTO_API_TOKEN!,fetch,{cloudOnly:true}),
  local:async(path:string,body?:unknown)=>{
   const r=await fetch('http://127.0.0.1:58888'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(body?55000:5000)});
   const v=await r.json();if(!r.ok||v.error||v.error_code||v.success===false)throw Error('e2e_desktop_request_failed');return v;
  },close:()=>pool.end()};
}
export type CycleContext=Awaited<ReturnType<typeof cycleContext>>;
