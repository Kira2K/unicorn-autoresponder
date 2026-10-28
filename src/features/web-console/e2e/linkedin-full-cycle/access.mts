import assert from 'node:assert/strict';import {createOctoApi} from '../../../octo-access-test/octo-api.mts';
import type {Page} from 'playwright';import type {CycleContext} from './context.mts';import type {RunJournal} from './journal.mts';
import {consoleUrl} from './context.mts';import {evidenceScreenshot,readJson,waitForCycle} from './ui.mts';
export async function verifyCycleAccess(c:CycleContext,page:Page,journal:RunJournal,cycle:number,taskId:number,profile:any){
 const current=String((await c.local('/api/username')).username).toLowerCase();if(current!==c.vars.OCTO_GUEST_EMAIL?.toLowerCase())throw Error('e2e_guest_desktop_required');
 const active=await c.local('/api/profiles/active');if(active.length)throw Error('e2e_desktop_has_active_profiles');
 const article=page.getByTestId(`octo-profile-${profile.profile_id}`);await article.getByRole('button',{name:'Получить доступ',exact:true}).click();
 await article.locator('.octo-credentials').waitFor();
 const state=await readJson(page.context(),`/api/linkedin-creator/tasks/${taskId}/octo/status`),id=state.profiles[0].grantId;
 let grant:any;await waitForCycle(async()=>{grant=await readJson(page.context(),`/api/linkedin-creator/tasks/${taskId}/octo/grants/${id}`);return grant.phase==='granted'&&!!grant.password;},'e2e_grant_timeout');
 const attempt=`cycle-${cycle}-open-attempt`;
 if(journal.data.checks.some(e=>e.step===attempt))throw Error('e2e_open_outcome_requires_review');
 await journal.record({step:attempt,expected:'Одно открытие только тестового профиля',actual:'Попытка записана до вызова Desktop',state:'blocked'});
 const desktop=createOctoApi(c.vars.OCTO_API_TOKEN!,fetch,{debugPort:true});
 let started=false,closeAttempted=false;
 try{
  await desktop.startProfile(profile.state.uuid,grant.password);started=true;
  assert.ok((await desktop.activeProfiles()).includes(profile.state.uuid));
  assert.equal(String((await c.local('/api/username')).username).toLowerCase(),c.vars.OCTO_GUEST_EMAIL?.toLowerCase());
  await journal.record({step:`cycle-${cycle}-guest-open`,expected:'Профиль реально открыт гостем',actual:'Desktop подтвердил STARTED и активный UUID под гостевой учётной записью',state:'passed',screenshot:await evidenceScreenshot(page,journal,`cycle-${cycle}-guest`)});
  closeAttempted=true;await c.local('/api/profiles/stop',{uuid:profile.state.uuid});
  await waitForCycle(async()=>!(await desktop.activeProfiles()).includes(profile.state.uuid),'e2e_profile_close_timeout',90000);
  await waitForCycle(()=>c.read(async s=>(await s.query("SELECT state->'grant'->>'phase' AS phase FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2",[profile.profile_id,journal.data.clientId])).rows[0]?.phase==='complete'),'e2e_cleanup_timeout',300000);
  const live=await c.cloud.getProfile(profile.state.uuid);assert.equal(live.status,0);assert.equal(live.title,profile.state.original.title);assert.equal(live.has_user_password,false);
  assert.ok(/[А-Яа-яЁё]/.test(live.title));
  await journal.record({step:`cycle-${cycle}-cleanup`,expected:'Доступ завершён, профиль закрыт и имя восстановлено кириллицей',actual:'Обычное закрытие и серверный cleanup подтверждены БД и Octo',state:'passed'});
  const marker=journal.data.checks.find(e=>e.step===attempt)!;marker.state='passed';marker.actual='Открытие и закрытие сверены с Desktop, БД и облаком';await journal.save();
 }finally{
  if(started&&!closeAttempted&&(await desktop.activeProfiles()).includes(profile.state.uuid))await c.local('/api/profiles/stop',{uuid:profile.state.uuid});
 }
}
