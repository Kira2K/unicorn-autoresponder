import assert from 'node:assert/strict';import {chromium} from 'playwright';import {createRequire} from 'node:module';
import type {CycleContext} from './context.mts';import type {RunJournal} from './journal.mts';import type {ProxyInput} from '../../../octo-access/contracts.mts';
import {ensureCycleClient,cycleDatabase,globalCycleIntegrity} from './database.mts';import {fixtureEmail,fixtureNames} from './contracts.mts';
import {assertConfirmed,assertReplacement} from './assertions.mts';import {consoleUrl} from './context.mts';
import {loginCycleUser,readJson,waitForCycle,evidenceScreenshot} from './ui.mts';import {submitCycleIntake} from './student.mts';import {completeCycleByCreator} from './creator.mts';
import {profileRules} from '../../../octo-access/profile-reservation.mts';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {auditCompletedCycles,auditPrivateRecipients} from './audit.mts';
import {confirmCycleByAdmin} from './admin.mts';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const {CLIENT_PASSWORD,ADMIN_EMAIL,ADMIN_PASSWORD}=createRequire(import.meta.url)('../../backend/app.ts');
export async function runBrowserCycles(c:CycleContext,journal:RunJournal,connections:Array<{input:ProxyInput}>){
 const browser=await chromium.launch({headless:true});
 try{
  const integrity=await globalCycleIntegrity(c),baselineClean=Object.values(integrity).every(v=>Number(v)===0);
  await journal.record({step:'database-baseline',expected:'Нет нарушений владельцев и связей в затронутых сущностях',actual:baselineClean?'Проверки целостности пройдены':'Обнаружены существующие несоответствия; чужие записи не изменяются',state:baselineClean?'passed':'failed',db:integrity});
  journal.data.clientId=await ensureCycleClient(c,journal.data.runId,'auto');await journal.save();
  const clientId=journal.data.clientId,db=cycleDatabase(c,journal.data.runId,clientId);
  const student=await loginCycleUser(browser,fixtureEmail(journal.data.runId,'auto'),CLIENT_PASSWORD),creator=await loginCycleUser(browser,c.vars.LINKEDIN_CREATOR_LOGIN!,c.vars.LINKEDIN_CREATOR_PASSWORD!);
  const admin=await loginCycleUser(browser,ADMIN_EMAIL,ADMIN_PASSWORD);
  await admin.page.getByTestId('admin-linkedin-tab').click();await admin.page.getByTestId('linkedin-admin-confirmations').waitFor();
  await creator.page.getByTestId('linkedin-creator-console').waitFor();
  let passwordHash=journal.data.baseline?.passwordHash,firstProfiles=journal.data.baseline?.profiles,oldRuHash=journal.data.baseline?.ruHash;
  for(const cycle of [1,2]){
   let snapshot=await db.snapshot();
   if(snapshot.cycles.length>=cycle){const task=snapshot.cycles[cycle-1];
    if(snapshot.cycles.length===cycle)assertConfirmed(snapshot,Number(task.task_id),cycle);
    else assert.equal(snapshot.notices.find(n=>Number(n.task_id)===Number(task.task_id))?.state,'sent');
    if(!journal.data.baseline)throw Error('e2e_baseline_missing');continue;}
   const before=snapshot;
   let current=snapshot.tasks.find(t=>t.source==='student_intake'&&t.status!=='выполнение подтверждено');
   const taskId=current?Number(current.id):await submitCycleIntake(student.page,journal,cycle);
   snapshot=await db.snapshot();assert.equal(snapshot.tasks.length,cycle);
   if(cycle===2){assertReplacement(before,snapshot,taskId);assert.equal(await db.profilePasswordHash(),passwordHash);}
   const onBlock=async()=>{
    await waitForCycle(async()=>await student.page.getByRole('button',{name:'Сохранить изменения',exact:true}).count()===1,'e2e_block_edit_timeout');
    const before=await readJson(creator.context,`/api/linkedin-creator/tasks/${taskId}`);
    const intake=await readJson(student.context,'/api/client/linkedin-intake');
    const r=await student.context.request.put(consoleUrl+'/api/client/linkedin-intake',{data:{...intake,blockedAccounts:intake.editableBlockedAccounts??intake.blockedAccounts,scenario:'new',password:'',outlookPassword:'',loggedIn:false}});
    assert.equal(r.status(),200);assert.equal((await r.json()).task.id,taskId);
    const after=await readJson(creator.context,`/api/linkedin-creator/tasks/${taskId}`);assert.equal(after.intake.url,before.intake.url);assert.equal(after.intake.login,before.intake.login);assert.equal(after.intake.hasPassword,true);
    await creator.page.getByTestId(`creation-task-${taskId}`).click();
   };
   if(current?.status!=='сделана экспертом')await completeCycleByCreator(c,creator.page,journal,taskId,cycle,connections[cycle-1].input,cycle===2?connections[0].input:undefined,onBlock);
   await waitForCycle(async()=>await student.page.getByTestId('linkedin-new-form').count()===0,'e2e_student_lock_timeout');
   const lockedIntake=await readJson(student.context,'/api/client/linkedin-intake');
   const closed=await student.context.request.put(consoleUrl+'/api/client/linkedin-intake',{data:{...lockedIntake,blockedAccounts:lockedIntake.editableBlockedAccounts??lockedIntake.blockedAccounts,scenario:'new',password:'',outlookPassword:'',loggedIn:false}});assert.equal(closed.status(),409);
   await confirmCycleByAdmin(admin,journal,taskId,cycle);
   await waitForCycle(async()=>{const s=await db.snapshot();return s.notices.find(n=>Number(n.task_id)===taskId)?.state==='sent';},'e2e_notification_timeout',90000);
   snapshot=await db.snapshot();assertConfirmed(snapshot,taskId,cycle);
   assertConfirmed(await db.snapshot(),taskId,cycle);
   await student.page.getByTestId('linkedin-report-ban').waitFor();
   assert.equal(await student.page.getByRole('button',{name:'Меня забанили',exact:true}).count(),1);
   const names=snapshot.profiles.map(p=>p.state.original.title);assert.ok(names.every(n=>String(n).startsWith('Павел Тестов')));
   if(cycle===1){passwordHash=await db.profilePasswordHash();firstProfiles=snapshot.profiles.map(p=>[Number(p.profile_id),String(p.state.uuid)]);oldRuHash=hash(snapshot.profiles.find(p=>p.locale==='ru')?.state);
    journal.data.baseline={passwordHash,profiles:firstProfiles,ruHash:oldRuHash};await journal.save();}
   else{assert.deepEqual(snapshot.profiles.map(p=>[Number(p.profile_id),String(p.state.uuid)]),firstProfiles);assert.equal(hash(snapshot.profiles.find(p=>p.locale==='ru')?.state),oldRuHash);}
   journal.data.completedCycles=[...new Set([...journal.data.completedCycles,cycle])];
   await journal.record({step:`cycle-${cycle}-confirmed`,expected:'Новый цикл, одна отправка, повтор не сбрасывает данные',actual:'Подтверждено через кнопку главного админа; read-back БД и уведомление sent проверены, доступ ученика восстановлен',state:'passed',db:{taskId,cycles:snapshot.cycles.length},screenshot:await evidenceScreenshot(student.page,journal,`cycle-${cycle}-confirmed`)});
  }
  await auditCompletedCycles(c,journal);
  await auditPrivateRecipients(c,journal);
  assert.deepEqual(await globalCycleIntegrity(c),integrity);
  if(!baselineClean||journal.data.checks.some(check=>check.state!=='passed')){journal.data.passed=false;await journal.save();return;}
  const manualId=await ensureCycleClient(c,journal.data.runId,'manual');journal.data.manualClientId=manualId;await journal.save();
  const manual=await loginCycleUser(browser,fixtureEmail(journal.data.runId,'manual'),CLIENT_PASSWORD);
  const intake=await readJson(manual.context,'/api/client/linkedin-intake');assert.equal(intake.hasLinkedIn,false);assert.equal(intake.task,undefined);assert.equal(intake.hasOutlookPassword,false);
  const counts=await c.read(async s=>(await s.query('SELECT (SELECT count(*)::int FROM noco.platform_accounts WHERE clients_id=$1) AS accounts,(SELECT count(*)::int FROM noco.linkedin_creation_task WHERE client_id=$1) AS tasks,(SELECT count(*)::int FROM noco.octo_profiles WHERE client_id=$1) AS profiles',[manualId])).rows[0]);assert.deepEqual(counts,{accounts:0,tasks:0,profiles:0});
  const m=fixtureNames.manual,title=profileRules.buildProfileName({firstName:m.first,lastName:m.last,clientName:`${m.first} ${m.last}`,primaryStack:'JAVA'} as any,'en');assert.ok(title.startsWith('Илья Проверкин'));
  const final=await db.snapshot(),en=final.profiles.find(p=>p.locale==='en');const denied=await manual.context.request.post(consoleUrl+'/api/octo/grants',{data:{profileId:en!.profile_id}});assert.ok([403,404].includes(denied.status()));
  assert.deepEqual(await globalCycleIntegrity(c),integrity);
  await journal.record({step:'manual-user',expected:'Кириллическое ФИО, чистый кабинет без аккаунтов и профилей',actual:'Вход проверен; ноль аккаунтов/заявок/Octo. Название проверено только правилом; живого профиля ещё нет.',state:'passed',db:{manualClientId:manualId,...counts},screenshot:await evidenceScreenshot(manual.page,journal,'manual-user')});
  await writeFile(resolve(journal.dir,'manual-private.json'),JSON.stringify({manualLogin:fixtureEmail(journal.data.runId,'manual'),manualPassword:CLIENT_PASSWORD}),{mode:0o600});
  journal.data.passed=true;await journal.save();
 }catch(e){journal.data.passed=false;await journal.record({step:'live-cycle',expected:'Два полностью пройденных цикла',actual:/^e2e_[a-z_]+$/.test((e as Error).message)?(e as Error).message:'e2e_live_assertion_failed',state:'failed'});throw e;}
 finally{await browser.close();}
}
