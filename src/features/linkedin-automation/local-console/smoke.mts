import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.LINKEDIN_E2E_CONSOLE_URL||'http://127.0.0.1:4320';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('e2e_loopback_required');
const browser=await chromium.launch({headless:true}),checks=[];
const {runId='20261106-local',testClientIds=[306,307]}=await fetch(base+'/api/local/linkedin-ready').then(r=>r.json());
try{
  for(const [email,password,kind] of [[`linkedin-cycle-${runId}-auto@example.invalid`,'1234','move'],[`linkedin-cycle-${runId}-manual@example.invalid`,'1234','new'],['local-denis','local-test-only','denis']]){
    const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(25000);let errors=0;page.on('pageerror',()=>errors++);
    await context.addInitScript((ids:number[])=>{for(const id of ids)localStorage.setItem(`webConsole.octoWelcome.v1.${id}`,'closed');},testClientIds);
    await page.goto(base);await page.getByTestId('email-input').fill(email);await page.locator('#password').fill(password);await page.getByTestId('login-button').click();await page.getByTestId('login-button').waitFor({state:'hidden'});
    if(await page.getByTestId('octo-welcome').waitFor({timeout:2000}).then(()=>true,()=>false))await page.getByRole('button',{name:'Понятно, продолжить',exact:true}).click();
    if(kind==='move'){await page.getByRole('button',{name:'Сменить прокси (Octo)',exact:true}).click();await page.getByTestId('linkedin-proxy-move').waitFor();
      const state=await page.context().request.get(base+'/api/client/linkedin-proxy-move'),body=await state.json();
      assert.equal(state.status(),200,`move state: ${body.error||'ok'}`);assert.ok(body.profileId);}
    if(kind==='new'){await page.locator('[data-testid="linkedin-octo-workflow"][data-proxy-move-checked="true"]').waitFor();const intake=await page.context().request.get(base+'/api/client/linkedin-intake').then(r=>r.json());if(intake.completionConfirmed){await page.getByTestId('linkedin-registration-completed').waitFor();assert.equal(await page.getByTestId('linkedin-registration-pending').count(),0);}else{assert.equal(await page.getByTestId('proxy-move-open').count(),0);if(!intake.task)await page.getByRole('button',{name:'Нет LinkedIn / аккаунт заблокирован',exact:true}).click();await page.getByTestId('outlook-forwarding').waitFor();}}
    if(kind==='denis'){await page.getByTestId('linkedin-creator-console').waitFor();const r=await page.context().request.get(base+'/api/linkedin-creator/tasks');assert.equal(r.status(),200);assert.ok((await r.json()).every((t:any)=>testClientIds.includes(t.clientId)));}
    await mkdir('tmp/linkedin-local-review',{recursive:true});await page.screenshot({path:`tmp/linkedin-local-review/${kind}.png`,fullPage:true,mask:[page.locator('input[type=password]'),page.locator('.octo-credentials')]});assert.equal(errors,0);checks.push({kind,login:true,runtimeErrors:errors});await context.close();
  }
  await writeFile('tmp/linkedin-local-review/smoke.json',JSON.stringify({base,checks},null,2));console.log(JSON.stringify({base,checks}));
}finally{await browser.close();}
