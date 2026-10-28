import {createProxyChecker} from '../../../octo-access/proxy-checker.mts';
import {parseProxyInput} from '../../../octo-access/proxy-input.mts';
import {proxyFingerprint} from '../../../linkedin-automation/creation-tasks/new-proxy.mts';
import type {ProxyInput} from '../../../octo-access/contracts.mts';
import type {CycleContext} from './context.mts';
import type {Evidence} from './contracts.mts';
export async function cyclePreflight(c:CycleContext){
 const checks:Evidence[]=[],connections:Array<{sourceUuid:string;input:ProxyInput;exitIp:string}>=[];
 const check=async(step:string,expected:string,fn:()=>Promise<Record<string,unknown>>)=>{
  try{const db=await fn();checks.push({step,expected,actual:'Проверка выполнена',db,state:'passed',at:new Date().toISOString()});}
  catch(e){checks.push({step,expected,actual:/^e2e_[a-z_]+$/.test((e as Error).message)?(e as Error).message:'e2e_preflight_unavailable',state:'blocked',at:new Date().toISOString()});}
 };
 await check('render','Кабинет и бот опубликованы из актуального master',async()=>{
  const deployments=await Promise.all(['srv-d8nnraok1i2s73dhp190','srv-d9cp1uu1a83c739ht35g'].map(id=>c.render(`services/${id}/deploys?limit=1`)));
  if(deployments.some(a=>a[0]?.deploy.status!=='live')||deployments[0][0].deploy.commit.id!==deployments[1][0].deploy.commit.id)throw Error('e2e_deployment_not_live');
  return{commit:deployments[0][0].deploy.commit.id};
 });
 await check('database','Схема цикла и ограниченные права приложения установлены',()=>c.read(async s=>{
  await s.query('SELECT baseline_connection FROM noco.linkedin_creation_proxy LIMIT 0');await s.query('SELECT state FROM noco.linkedin_cycle_notifications LIMIT 0');
  const r=(await s.query("SELECT has_table_privilege('unicorn_sql_app','noco.linkedin_creation_proxy','SELECT,UPDATE') AS proof,has_table_privilege('unicorn_sql_app','noco.linkedin_cycle_notifications','SELECT,UPDATE') AS notice,pg_has_role('unicorn_sql_app','unicorn_noco_copy_owner','MEMBER') AS owner")).rows[0];
  if(!r.proof||!r.notice||r.owner)throw Error('e2e_database_rights_invalid');return r;
 }));
 await check('guest_rights','Гость видит только выделенную папку и не может менять профили/прокси',async()=>{
  await c.cloud.validateGuest(c.vars.OCTO_GUEST_EMAIL!,c.vars.OCTO_GUEST_FOLDER_UUID!);return{validated:true};
 });
 await check('desktop','Octo открыт под гостем, нет чужих открытых профилей',async()=>{
  const user=await c.local('/api/username'),active=await c.local('/api/profiles/active');
  if(!Array.isArray(active)||active.length)throw Error('e2e_desktop_has_active_profiles');
  if(String(user.username).toLowerCase()!==c.vars.OCTO_GUEST_EMAIL?.toLowerCase())throw Error('e2e_guest_desktop_required');return{guest:true,active:0};
 });
 await check('bridge','Штатный backend готов обрабатывать cleanup',async()=>{
  if(c.vars.OCTO_PASSWORD_CLEANUP!=='bridge')return{mode:'cloud'};
  const r=await fetch('https://very-evil-unicorn.onrender.com/internal/octo-bridge/v1/health',{headers:{Authorization:`Bearer ${c.vars.OCTO_BRIDGE_SECRET}`},signal:AbortSignal.timeout(15000)});
  if(!r.ok||(await r.json()).ready!==true)throw Error('e2e_bridge_unavailable');return{mode:'bridge',ready:true};
 });
 await check('proxies','Два свободных тестовых подключения работают и дают разные IP',async()=>{
  const base=c.env.LINKEDIN_E2E_CHECKER_URL||'http://127.0.0.1:8002';
  const health=await fetch(base+'/health',{signal:AbortSignal.timeout(5000)});if(!health.ok)throw Error('e2e_checker_unavailable');
  const checker=createProxyChecker({baseUrl:base,secret:c.env.UNICORN_PROXY_CHECKER_SECRET_KEY!});
  const reserved=new Set(await c.read(async s=>(await s.query("SELECT state->'proxy'->>'uuid' AS uuid FROM noco.octo_profiles UNION SELECT state->'proxyChange'->>'uuid' FROM noco.octo_profiles")).rows.map(r=>r.uuid)));
  const rows=await c.rawCloud.cloudRequest('/proxies');
  const candidates=rows.filter((p:any)=>p.profiles_count===0&&/test|тест|e2e|demo|демо/i.test(p.title)&&!reserved.has(p.uuid)).sort((a:any,b:any)=>a.uuid.localeCompare(b.uuid));
  let tried=0;
  for(const row of candidates){
   tried++;try{
    const input=parseProxyInput({...row,type:row.type==='socks'?'socks4':row.type,changeIpUrl:row.change_ip_url});
    const host=input.host.includes(':')?`[${input.host.replace(/^\[|\]$/g,'')}]`:input.host;
    const uri=`${input.type==='socks5'?'socks5h':input.type}://${encodeURIComponent(input.login)}:${encodeURIComponent(input.password)}@${host}:${input.port}`;
    const result=await checker.check(uri);if(!result.exit_ip)continue;
    if(connections.some(p=>p.exitIp===result.exit_ip||proxyFingerprint(p.input)===proxyFingerprint(input)))continue;
    connections.push({sourceUuid:row.uuid,input,exitIp:result.exit_ip});if(connections.length===2)break;
   }catch{/* Input and provider exceptions must never expose proxy credentials. */}
  }
  if(connections.length<2)throw Error('e2e_two_working_test_proxies_required');
  return{candidates:candidates.length,tried,working:connections.length,differentIp:true};
 });
 return{checks,connections,passed:checks.every(x=>x.state==='passed')};
}
