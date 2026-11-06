import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createPostgresPool} from '../../../integrations/postgres/pg-pool.mts';
import {readPostgresAppDbConfig} from '../../../platform/db/postgres/config.mts';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
const base='http://127.0.0.1:4320',directory='tmp/linkedin-local-completed';await mkdir(directory,{recursive:true});
const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config),read=createReadSession(pool,config.database),browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.name));
  await page.addInitScript(()=>localStorage.setItem('webConsole.octoWelcome.v1.307','closed'));
  await page.goto(base);await page.getByTestId('email-input').fill('linkedin-cycle-20261106-local-manual@example.invalid');await page.locator('#password').fill('1234');await page.getByTestId('login-button').click();
  await page.getByTestId('linkedin-registration-completed').waitFor();assert.equal(await page.getByTestId('linkedin-registration-pending').count(),0);
  const r=await page.request.get(base+'/api/client/linkedin-intake'),intake=await r.json();assert.equal(r.status(),200);assert.equal(intake.task.id,52);assert.equal(intake.task.status,'сделана экспертом');assert.equal(intake.completionConfirmed,true);assert.equal(intake.registrationPending,false);assert.equal(intake.editLocked,true);
  const row=page.getByTestId('accounts-table').locator('tbody tr').filter({has:page.getByRole('cell',{name:/^linkedin$/i})});await row.getByText('Активен',{exact:true}).waitFor();assert.equal(await row.getByText('В процессе создания',{exact:true}).count(),0);
  await page.getByTestId('octo-profile-435').waitFor();const button=page.getByTestId('octo-profile-435').getByRole('button',{name:'Получить доступ',exact:true});assert.equal(await button.isEnabled(),true);
  let grantWrites=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/octo/'))grantWrites++;});await button.click();const warning=page.getByRole('dialog',{name:'Доступ к Octo готов',exact:true});await warning.waitFor();await warning.getByRole('button',{name:'Пока не открывать',exact:true}).click();assert.equal(grantWrites,0,'warmup warning does not issue a grant before acknowledgement');
  await page.getByTestId('proxy-move-open').waitFor();const move=await page.request.get(base+'/api/client/linkedin-proxy-move');assert.equal(move.status(),200);
  assert.equal((await page.request.post(base+'/api/admin/linkedin-creation/tasks/52/confirm',{data:{version:intake.task.version}})).status(),404);
  await page.reload();await page.getByTestId('linkedin-registration-completed').waitFor();await row.getByText('Активен',{exact:true}).waitFor();assert.equal(await page.getByTestId('linkedin-registration-pending').count(),0);
  const db=await read(async s=>({cycles:(await s.query('SELECT task_id,applied_at FROM noco.linkedin_account_cycles WHERE task_id=52 AND client_id=307')).rows,deliveries:(await s.query('SELECT recipient,state,message_id FROM noco.linkedin_cycle_notifications WHERE task_id=52 AND client_id=307 ORDER BY recipient')).rows}));assert.equal(db.cycles.length,1);assert.equal(db.deliveries.length,2);assert.deepEqual(db.deliveries.map(r=>r.recipient),['reports','student']);assert.deepEqual(errors,[]);
  await page.screenshot({path:directory+'/student.png',fullPage:true,mask:[page.locator('input'),page.locator('.octo-credentials'),page.locator('.octo-proxy'),page.getByTestId('accounts-table').locator('tbody tr td:nth-last-child(2)')]});
  const report={passed:true,clientId:307,taskId:52,completionConfirmed:true,registrationPending:false,accountStatus:'Активен',octoProfileId:435,canAcquire:true,proxyMoveHttp:move.status(),reload:true,cycles:db.cycles.length,deliveries:db.deliveries,grantWrites,runtimeErrors:errors};await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();await pool.end();}
