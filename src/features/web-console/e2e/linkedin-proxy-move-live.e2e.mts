import {chromium} from 'playwright';
import {createRequire} from 'node:module';
process.env.LINKEDIN_E2E_CONSOLE_URL??='http://127.0.0.1:4320';
const {cycleContext}=await import('./linkedin-full-cycle/context.mts');
const {parseCycleArgs,fixtureEmail,assertFixture}=await import('./linkedin-full-cycle/contracts.mts');
const {openCycleJournal}=await import('./linkedin-full-cycle/journal.mts');
const {lockCycleRun}=await import('./linkedin-full-cycle/run-lock.mts');
const {loginCycleUser}=await import('./linkedin-full-cycle/ui.mts');
const {proxyMoveTestInput,runLiveProxyMove}=await import('./linkedin-proxy-move/live.mts');
const {checkProxyCheckerConnection}=await import('../../octo-access/checker-preflight.mts');
const options=parseCycleArgs(process.argv.slice(2));
const journal=await openCycleJournal(options.runId||'20261106-local','tmp/linkedin-proxy-move'),release=await lockCycleRun(journal.dir,journal.data.runId);
let c:Awaited<ReturnType<typeof cycleContext>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  c=await cycleContext(process.env);
  if(!c.localConsoleTarget)throw Error('e2e_proxy_move_loopback_required');
  const ready=await fetch(c.consoleUrl+'/api/local/linkedin-ready',{signal:AbortSignal.timeout(5000)});
  if(!ready.ok||(await ready.json()).remoteOctoWorker!==true)throw Error('e2e_remote_worker_required');
  const row=await c.read(async s=>(await s.query('SELECT * FROM noco.clients WHERE lower(calendar_email)=$1',[fixtureEmail(journal.data.runId,'auto')])).rows[0]);
  if(!row)throw Error('e2e_fixture_missing');assertFixture(row,journal.data.runId,'auto');journal.data.clientId=Number(row.id);await journal.save();
  const existing=await c.read(async s=>(await s.query('SELECT data FROM noco.linkedin_proxy_move WHERE client_id=$1',[row.id])).rows[0]);
  if(!existing)await proxyMoveTestInput(c);
  if((existing?.data as {phase?:string}|undefined)?.phase!=='completed'){
    const username=await c.local('/api/username'),active=await c.local('/api/profiles/active');
    if(String(username.username).toLowerCase()!==c.vars.OCTO_GUEST_EMAIL?.toLowerCase())throw Error('e2e_guest_desktop_required');
    if(!Array.isArray(active)||active.length)throw Error('e2e_desktop_has_active_profiles');
    await checkProxyCheckerConnection({...process.env,PROXY_CHECKER_BASE_URL:process.env.LINKEDIN_LOCAL_CHECKER_URL||'http://127.0.0.1:8002'});
  }
  console.log(JSON.stringify({runId:journal.data.runId,preflight:'passed',mode:options.apply?'apply':'preflight'}));
  if(options.apply){browser=await chromium.launch({headless:true});const {CLIENT_PASSWORD}=createRequire(import.meta.url)('../backend/app.ts');
    const student=await loginCycleUser(browser,fixtureEmail(journal.data.runId,'auto'),CLIENT_PASSWORD);await runLiveProxyMove(c,journal,student.page);}
}catch(error){const message=String((error as Error).message),code=/^e2e_[a-z_]+$/.test(message)?message:'e2e_proxy_move_failed';
  await journal.record({step:'proxy-move-run',state:options.apply?'failed':'blocked',expected:'Готовое окружение и отдельный тестовый прокси нужной страны',actual:code});console.error(code);process.exitCode=2;}
finally{await browser?.close();await c?.close();await release();}
