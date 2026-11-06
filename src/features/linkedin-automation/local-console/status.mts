import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {fixtureEmail,assertFixture} from '../../web-console/e2e/linkedin-full-cycle/contracts.mts';
import {createOctoApi} from '../../octo-access-test/octo-api.mts';
import {controlIdentity} from '../../octo-access/control-identity.mts';
import {readControlConfig} from '../../octo-access/control-config.mts';
import {readOctoConfig} from '../../octo-access/config.mts';
import type {ManagedProfile} from '../../octo-access/contracts.mts';
import {unusedTestProxy} from './test-proxy.mts';
const args=process.argv.slice(2),runId=args.includes('--run-id')?args[args.indexOf('--run-id')+1]:'20261106-local';
if(!/^[a-z0-9-]{8,64}$/.test(runId))throw Error('linkedin_local_invalid_run_id');
const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database);
try{
  const profiles=await read(async s=>{const ids:number[]=[];for(const kind of ['auto','manual'] as const){const row=(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(runId,kind)])).rows[0];if(row){assertFixture(row,runId,kind);ids.push(Number(row.id));}}
    return(await s.query('SELECT state FROM noco.octo_profiles WHERE client_id=ANY($1::bigint[]) ORDER BY profile_id',[ids])).rows.map(r=>r.state as ManagedProfile);});
  const control=readControlConfig(process.env),octo=readOctoConfig(process.env),states=[];
  for(const p of profiles){let workerReady=false,workerCode:string|undefined;if(control?.url&&octo&&p.uuid){try{const r=await fetch(control.url+'/internal/octo-control/v1/ready',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${control.secret}`,'Content-Type':'application/json'},body:JSON.stringify({clientId:p.clientId,profileId:p.id,identity:controlIdentity(p,octo)})});const body=await r.json();workerReady=r.ok&&body.ready===true;if(/^[a-z_]{1,80}$/.test(body.error))workerCode=body.error;}catch{workerCode='request_failed';}}
    states.push({id:p.id,clientId:p.clientId,locale:p.locale,phase:p.phase,error:p.error,proxyConfigured:!!p.proxy,grant:p.grant?.phase,workerReady,workerCode});}
  let unusedTestProxyUuids:string[]=[],checkerReady=false;
  try{const raw=createOctoApi(process.env.OCTO_API_TOKEN!,fetch,{cloudOnly:true}),all=await raw.cloudRequest('/proxies');
    unusedTestProxyUuids=all.filter((p:any)=>{try{unusedTestProxy(all,String(p.uuid));return true;}catch{return false;}}).map((p:any)=>String(p.uuid));
  }catch{}
  try{checkerReady=(await fetch((process.env.LINKEDIN_LOCAL_CHECKER_URL||'http://127.0.0.1:8002')+'/health',{signal:AbortSignal.timeout(5000)})).ok;}catch{}
  let desktopAvailable=false,desktopGuest=false,activeProfilesCount:number|undefined;
  try{const user=await fetch('http://127.0.0.1:58888/api/username',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
    const active=await fetch('http://127.0.0.1:58888/api/profiles/active',{signal:AbortSignal.timeout(3000)}).then(r=>r.json());
    desktopAvailable=true;desktopGuest=String(user.username).toLowerCase()===octo?.guest.email.toLowerCase();if(Array.isArray(active))activeProfilesCount=active.length;
  }catch{}
  console.log(JSON.stringify({runId,profiles:states,checkerConfigured:!!process.env.PROXY_CHECKER_BASE_URL&&!!process.env.UNICORN_PROXY_CHECKER_SECRET_KEY,checkerReady,desktopAvailable,desktopGuest,activeProfilesCount,unusedTestProxyUuids}));
}catch{console.error('linkedin_local_status_failed');process.exitCode=1;}finally{await pool.end();}
