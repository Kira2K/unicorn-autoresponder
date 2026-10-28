import assert from 'node:assert/strict';import type {Page} from 'playwright';
import type {CycleContext} from './context.mts';import type {RunJournal} from './journal.mts';import type {ProxyInput} from '../../../octo-access/contracts.mts';
import {proxyFingerprint} from '../../../linkedin-automation/creation-tasks/new-proxy.mts';
import {consoleUrl} from './context.mts';import {readJson,submitAndRead,waitForCycle,evidenceScreenshot} from './ui.mts';import {verifyCycleAccess} from './access.mts';
async function fillProxy(page:Page,pid:number,input:ProxyInput){
 const form=page.getByTestId(`octo-proxy-form-${pid}`);await form.getByTestId(`octo-proxy-${pid}-type`).selectOption(input.type);
 for(const field of ['host','port','login','password'] as const)await form.getByTestId(`octo-proxy-${pid}-${field}`).fill(String(input[field]));
 return form;
}
export async function completeCycleByCreator(c:CycleContext,page:Page,journal:RunJournal,taskId:number,cycle:number,input:ProxyInput,oldInput:ProxyInput|undefined,onBlock:()=>Promise<void>){
 await page.getByRole('button',{name:'Обновить список',exact:true}).click();await page.getByTestId(`creation-task-${taskId}`).click();await page.getByTestId('creation-task-detail').waitFor();
 let profile:any;
 await waitForCycle(async()=>{profile=await c.read(async s=>(await s.query("SELECT profile_id,state FROM noco.octo_profiles WHERE client_id=$1 AND locale='en'",[journal.data.clientId])).rows[0]);
  if(profile?.state.phase==='blocked')throw Error('e2e_provisioning_blocked');return profile?.state.phase==='ready';},'e2e_profiles_timeout',300000);
 await page.getByTestId(`octo-profile-${profile.profile_id}`).waitFor();
 const proof=await c.read(async s=>(await s.query('SELECT fingerprint FROM noco.linkedin_creation_proxy WHERE task_id=$1',[taskId])).rows[0]);
 if(proof?.fingerprint!==proxyFingerprint(input)){
  assert.equal(await page.getByRole('button',{name:'Получить доступ',exact:true}).isEnabled(),false);
  if(oldInput){
   const form=await fillProxy(page,profile.profile_id,oldInput);
   const r=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/profiles/${profile.profile_id}/proxy`)&&r.request().method()==='POST');await form.getByRole('button',{name:'Сохранить прокси',exact:true}).click();
   assert.equal((await r).status(),409);await page.getByText('Для нового LinkedIn нужны новые реквизиты прокси. Сейчас введено прежнее подключение.',{exact:true}).waitFor();
   await journal.record({step:'cycle-2-reused-proxy',expected:'Прежние реквизиты отклоняются',actual:'409 и понятная ошибка в форме, назначение не выполняется',state:'passed'});
  }
  if(journal.data.checks.some(e=>e.step===`cycle-${cycle}-proxy-attempt`))throw Error('e2e_proxy_outcome_requires_review');
  const form=await fillProxy(page,profile.profile_id,input);
  await journal.record({step:`cycle-${cycle}-proxy-attempt`,expected:'Одно назначение нового подключения',actual:'Попытка записана перед POST',state:'blocked'});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/profiles/${profile.profile_id}/proxy`)&&r.request().method()==='POST',{timeout:900000});
  await form.getByRole('button',{name:'Сохранить прокси',exact:true}).click();if(!(await response).ok())throw Error('e2e_new_proxy_rejected');
 }
 await waitForCycle(async()=>{profile=await c.read(async s=>(await s.query("SELECT profile_id,state FROM noco.octo_profiles WHERE client_id=$1 AND locale='en'",[journal.data.clientId])).rows[0]);
  if(profile.state.proxyChange?.phase==='blocked')throw Error('e2e_proxy_assignment_blocked');return profile.state.proxyChange?.phase==='complete';},'e2e_proxy_assignment_timeout',300000);
 const actual=(await c.cloud.readProfileProxy!(profile.state.uuid)).saved;assert.ok(actual);assert.equal(proxyFingerprint(actual),proxyFingerprint(input));
 const attempt=journal.data.checks.find(e=>e.step===`cycle-${cycle}-proxy-attempt`);if(attempt){attempt.state='passed';attempt.actual='Назначение сверено с фактическим подключением Octo';await journal.save();}
 await waitForCycle(async()=>await page.getByRole('button',{name:'Получить доступ',exact:true}).isEnabled(),'e2e_access_ui_timeout');
 await verifyCycleAccess(c,page,journal,cycle,taskId,profile);
 await waitForCycle(async()=>await page.getByRole('button',{name:'Сохранить настройки прокси',exact:true}).isEnabled(),'e2e_capture_ui_timeout');
 await submitAndRead(page,`/api/linkedin-creator/tasks/${taskId}/capture-proxy`,()=>page.getByRole('button',{name:'Сохранить настройки прокси',exact:true}).click());
 const detail=await readJson(page.context(),`/api/linkedin-creator/tasks/${taskId}`);
 assert.equal(await page.getByLabel('Логин LinkedIn',{exact:true}).inputValue(),detail.intake.outlookLogin);
 await page.getByLabel('Ссылка LinkedIn',{exact:true}).fill(`https://www.linkedin.com/in/veu-synthetic-${journal.data.runId}-${cycle}`);
 await page.getByLabel('Пароль LinkedIn',{exact:true}).fill(`SYNTHETIC-LI-${journal.data.runId}-${cycle}`);
 await submitAndRead(page,`/api/linkedin-creator/tasks/${taskId}/result`,()=>page.getByRole('button',{name:'Сохранить данные LinkedIn',exact:true}).click());
 if(cycle===2){await page.getByLabel('Статус заявки',{exact:true}).selectOption('блок');await submitAndRead(page,`/api/linkedin-creator/tasks/${taskId}/status`,()=>page.getByRole('button',{name:'Сохранить статус',exact:true}).click());await onBlock();}
 await page.getByLabel('Статус заявки',{exact:true}).selectOption('сделана экспертом');
 await submitAndRead(page,`/api/linkedin-creator/tasks/${taskId}/status`,()=>page.getByRole('button',{name:'Сохранить статус',exact:true}).click());
 await journal.record({step:`cycle-${cycle}-expert-done`,expected:'Результат сохранён; логин взят из Outlook этой заявки',actual:'Денис сохранил синтетический результат и завершил заявку через UI',state:'passed',screenshot:await evidenceScreenshot(page,journal,`cycle-${cycle}-expert-done`)});
}
