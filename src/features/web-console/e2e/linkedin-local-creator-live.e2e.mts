import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import {assertFixture,fixtureEmail} from './linkedin-full-cycle/contracts.mts';
import {createOctoApi} from '../../octo-access-test/octo-api.mts';
import {unusedTestProxy} from '../../linkedin-automation/local-console/test-proxy.mts';
const base='http://127.0.0.1:4320',runId='20261106-local',clientId=307;
if(!process.argv.includes('--apply'))throw Error('e2e_apply_required');
const directory=resolve('tmp/linkedin-local-creator-live'),file=resolve(directory,'report.json');await mkdir(directory,{recursive:true});
let report:any={runId,clientId,checks:[]};try{report=JSON.parse(await readFile(file,'utf8'));assert.equal(report.clientId,clientId);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const save=()=>writeFile(file,JSON.stringify(report,null,2));
let stage='preflight';const mark=async(name:string,data:Record<string,unknown>={})=>{stage=name;report.stage=name;delete report.error;report.checks.push({name,...data,at:new Date().toISOString()});await save();console.log(JSON.stringify({stage:name,...data}));};
const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database),desktop=createOctoApi(process.env.OCTO_API_TOKEN!,fetch,{debugPort:true});
const browser=await chromium.launch({headless:true});
const request=async(context:import('playwright').BrowserContext,path:string)=>{const r=await context.request.get(base+path);const data=await r.json();if(!r.ok())throw Error(/^\w+$/.test(data.error||'')?`e2e_${data.error}`:'e2e_read_failed');return data;};
async function wait(fn:()=>Promise<boolean>,code:string,timeout=180000){const until=Date.now()+timeout;let nextProgress=Date.now()+20000;while(Date.now()<until){if(await fn())return;if(Date.now()>nextProgress){console.log(JSON.stringify({stage,waiting:true}));nextProgress=Date.now()+20000;}await new Promise(r=>setTimeout(r,1500));}throw Error(code);}
async function login(email:string,password:string){const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addInitScript(()=>{for(const id of [306,307])localStorage.setItem(`webConsole.octoWelcome.v1.${id}`,'closed');});const page=await context.newPage();page.setDefaultTimeout(90000);await page.goto(base);await page.getByTestId('email-input').fill(email);await page.locator('#password').fill(password);await page.getByTestId('login-button').click();await page.getByTestId('login-button').waitFor({state:'hidden'});return{context,page};}
async function screenshot(page:import('playwright').Page,name:string){await page.screenshot({path:resolve(directory,name+'.png'),fullPage:true,mask:[page.locator('input'),page.locator('.octo-credentials'),page.locator('.octo-proxy')]});}
try{
  await read(async s=>{const c=(await s.query('SELECT * FROM noco.clients WHERE id=$1',[clientId])).rows[0];assertFixture(c,runId,'manual');});
  const username=await fetch('http://127.0.0.1:58888/api/username').then(r=>r.json());if(String(username.username).toLowerCase()!==process.env.OCTO_GUEST_EMAIL?.toLowerCase())throw Error('e2e_guest_required');
  if((await desktop.activeProfiles()).length&&!report.openAttempt)throw Error('e2e_desktop_busy');
  const student=await login(fixtureEmail(runId,'manual'),'1234');
  let intake=await request(student.context,'/api/client/linkedin-intake');
  if(!intake.task){
    await mark('create-intake');await student.page.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).click();
    const form=student.page.getByTestId('linkedin-new-form');
    for(const [label,value]of [['Логин от новой почты Outlook','linkedin-local-307-20261106@outlook.com'],['Пароль от новой почты Outlook','SYNTHETIC-LOCAL-ONLY'],['Дата и время регистрации Outlook-почты','2026-10-25T10:30'],['Имя латиницей (как в иностранных документах)','Ilya'],['Фамилия латиницей (как в иностранных документах)','Proverkin'],['Город и страна проживания','Tbilisi, Georgia']])await form.getByLabel(label,{exact:true}).fill(value);
    await form.getByTestId('outlook-forwarding').locator('summary').click();await form.getByTestId('outlook-forwarding').getByRole('checkbox').check();
    const response=student.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/client/linkedin-intake'&&r.request().method()==='PUT');await form.getByRole('button',{name:'Сохранить и подготовить Octo',exact:true}).click();if(!(await response).ok())throw Error('e2e_intake_rejected');
    intake=await request(student.context,'/api/client/linkedin-intake');
  }
  assert.equal(intake.task.clientId,clientId);report.taskId=intake.task.id;await save();
  if(intake.task.status==='сделана экспертом'||intake.task.status==='выполнение подтверждено')throw Error('e2e_fixture_task_already_completed');
  const creator=await login('local-denis','local-test-only'),path=`/api/linkedin-creator/tasks/${report.taskId}`;
  await creator.page.getByTestId(`creation-task-${report.taskId}`).click();
  let status:any;await mark('wait-en-profile',{taskId:report.taskId});
  await wait(async()=>{status=await request(creator.context,path+'/octo/status');return status.profiles?.some((p:any)=>p.locale==='en'&&p.phase==='ready');},'e2e_en_not_ready');
  const profileId=status.profiles.find((p:any)=>p.locale==='en').id;report.profileId=profileId;await save();
  if(!status.newProxyReady){
    await mark('save-proxy');const all=await desktop.cloudRequest('/proxies');let input:any,sourceUuid:string|undefined;
    const explicit=process.argv.includes('--proxy-uuid')?process.argv[process.argv.indexOf('--proxy-uuid')+1]:undefined;
    for(const row of all.filter((p:any)=>!explicit||p.uuid===explicit).sort((a:any,b:any)=>a.uuid.localeCompare(b.uuid))){try{input=unusedTestProxy(all,row.uuid);sourceUuid=row.uuid;break;}catch{}}
    if(!input)throw Error('e2e_unused_test_proxy_required');report.sourceProxyUuid=sourceUuid;await save();
    await mark('fill-proxy');const form=creator.page.getByTestId(`octo-proxy-form-${profileId}`);await form.waitFor();await form.getByTestId(`octo-proxy-${profileId}-type`).selectOption(input.type);
    for(const [label,value]of [['Адрес прокси',input.host],['Порт прокси',String(input.port)],['Логин прокси',input.login],['Пароль прокси',input.password],['URL смены IP (необязательно)',input.changeIpUrl||'']])await form.getByLabel(label,{exact:true}).fill(value);
    await mark('submit-proxy');const response=creator.page.waitForResponse(r=>new URL(r.url()).pathname===path+`/octo/profiles/${profileId}/proxy`);await creator.page.getByTestId(`octo-proxy-save-${profileId}`).click();const r=await response;if(!r.ok()){const d=await r.json();throw Error(/^\w+$/.test(d.error||'')?`e2e_${d.error}`:'e2e_proxy_rejected');}
    await wait(async()=>{status=await request(creator.context,path+'/octo/status');return status.newProxyReady&&status.profiles.some((p:any)=>p.id===profileId&&p.proxy?.configured);},'e2e_proxy_not_attached');
  }
  let detail=await request(creator.context,path);if(!detail.task.proxySavedAt){await mark('capture-proxy');await creator.page.getByRole('button',{name:'Сохранить настройки прокси',exact:true}).click();await creator.page.getByText('Прокси сохранён и проверен.',{exact:true}).waitFor();}
  detail=await request(creator.context,path);const receipt=detail.task.proxySavedAt;assert.ok(receipt);await screenshot(creator.page,'proxy-saved');
  await mark('draft-revert');const host=creator.page.getByLabel('Адрес прокси',{exact:true}),original=await host.inputValue();await host.fill('edited.example.invalid');await creator.page.getByText('Есть несохранённые изменения.',{exact:false}).waitFor();assert.equal(await creator.page.getByText('Прокси сохранён и проверен.',{exact:true}).count(),0);await host.fill(original);await creator.page.getByText('Прокси сохранён и проверен.',{exact:true}).waitFor();
  const p=await read(async s=>(await s.query('SELECT state FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2',[profileId,clientId])).rows[0]?.state as any);if(!p?.uuid)throw Error('e2e_profile_binding_changed');
  if(!report.cleanupVerified){
    await mark('grant-and-open');
    if(!report.openAttempt){await creator.page.getByTestId(`octo-profile-${profileId}`).getByRole('button',{name:'Получить доступ',exact:true}).click();await creator.page.locator('.octo-credentials').waitFor();
      const state=await request(creator.context,path+'/octo/status'),grantId=state.profiles.find((p:any)=>p.id===profileId)?.grantId;let grant:any;
      await wait(async()=>{grant=await request(creator.context,path+'/octo/grants/'+grantId);return grant.phase==='granted'&&!!grant.password;},'e2e_grant_timeout');
      assert.equal((await request(creator.context,path)).task.proxySavedAt,receipt);await creator.page.getByText('Прокси сохранён и проверен.',{exact:true}).waitFor();
      report.openAttempt={uuid:p.uuid,at:new Date().toISOString()};await save();await desktop.startProfile(p.uuid,grant.password);assert.ok((await desktop.activeProfiles()).includes(p.uuid));report.openVerified=true;await save();await screenshot(creator.page,'profile-open-confirmation-preserved');
    }
    if((await desktop.activeProfiles()).includes(p.uuid)){await fetch('http://127.0.0.1:58888/api/profiles/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid:p.uuid})}).then(async r=>{if(!r.ok)throw Error('e2e_stop_failed');});}
    await mark('wait-access-cleanup');await wait(()=>read(async s=>(await s.query("SELECT state->'grant'->>'phase' AS phase FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2",[profileId,clientId])).rows[0]?.phase==='complete'),'e2e_cleanup_timeout',300000);
    const cloud=await desktop.getProfile(p.uuid);assert.equal(cloud.status,0);assert.equal(cloud.has_user_password,false);report.cleanupVerified=true;await save();
  }
  await creator.page.reload();await creator.page.getByTestId(`creation-task-${report.taskId}`).click();await creator.page.getByText('Прокси сохранён и проверен.',{exact:true}).waitFor();assert.equal((await request(creator.context,path)).task.proxySavedAt,receipt);
  await mark('save-synthetic-result');await creator.page.getByLabel('Ссылка LinkedIn',{exact:true}).fill('https://www.linkedin.com/in/synthetic-local-denis-307');await creator.page.getByLabel('Логин LinkedIn',{exact:true}).fill('linkedin-local-307-20261106@outlook.com');await creator.page.getByLabel('Пароль LinkedIn',{exact:true}).fill('SYNTHETIC-LOCAL-ONLY');await creator.page.getByRole('button',{name:'Сохранить данные LinkedIn',exact:true}).click();await creator.page.getByText('Данные LinkedIn сохранены.',{exact:true}).waitFor();
  const done=creator.page.getByRole('option',{name:'сделана экспертом',exact:true});assert.equal(await done.isEnabled(),true);
  await mark('save-editable-status');await creator.page.getByLabel('Статус заявки',{exact:true}).selectOption({label:'не начата'});const statusResponse=creator.page.waitForResponse(r=>new URL(r.url()).pathname===path+'/status'&&r.request().method()==='PUT');await creator.page.getByRole('button',{name:'Сохранить статус',exact:true}).click();assert.ok((await statusResponse).ok());await creator.page.getByText('Статус сохранён.',{exact:true}).waitFor();await wait(()=>creator.page.getByRole('button',{name:'Сохранить статус',exact:true}).isEnabled(),'e2e_status_form_busy');await screenshot(creator.page,'ready-for-denis');
  const final=await request(creator.context,path);assert.equal(final.task.status,'не начата');assert.equal(final.task.proxySavedAt,receipt);
  report.passed=true;report.receipt=receipt;report.finalStatus=final.task.status;await mark('passed',{taskId:report.taskId,profileId,keptEditable:true});
}catch(error){report.passed=false;report.stage=stage;const message=String((error as Error).message);report.error=/^e2e_[a-z_0-9]+$/.test(message)?message:'e2e_creator_live_failed';await save();console.error(JSON.stringify({stage,error:report.error,taskId:report.taskId}));process.exitCode=1;}
finally{await browser.close();await pool.end();}
