import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { OctoHhSession, OctoHhSettings, OctoHhTarget } from './run.mts';
const require=createRequire(import.meta.url);
interface HhLoginPage {goto(url:string,options?:Record<string,unknown>):Promise<unknown>}
export async function authenticateOctoHhPage(page:HhLoginPage,credentials:OctoHhTarget['hhAuthCredentials'],timeoutMs:number,
  deps:{detect(page:HhLoginPage):Promise<{state:string}>;
    authorize(page:HhLoginPage,options:{credentials:OctoHhTarget['hhAuthCredentials'];timeoutMs:number;log:()=>void}):Promise<unknown>;
    check():void}){
  deps.check();const initial=await deps.detect(page);
  if(initial.state!=='logged_out'||!credentials?.login||!credentials?.password)return initial.state;
  // The HH homepage signup email field can match generic login selectors.
  // Resolve that ambiguity in this Octo adapter before reusing the shared login workflow.
  deps.check();await page.goto('https://hh.ru/account/login',{waitUntil:'domcontentloaded',timeout:timeoutMs});
  deps.check();await deps.authorize(page,{credentials,timeoutMs,log:()=>{}});
  deps.check();return (await deps.detect(page)).state;
}
export function isLinkedInUrl(value:string){
  try{return /(^|\.)linkedin\.com$/i.test(new URL(value).hostname.replace(/\.$/,''));}catch{return false;}
}
export function linkedinRequestGuard(route:{request():{url():string};abort(reason?:string):Promise<void>;continue():Promise<void>}){
  return isLinkedInUrl(route.request().url())?route.abort('blockedbyclient'):route.continue();
}
export interface HhRequestRoute {
  request(): {url():string;method():string}; abort(reason?:string):Promise<void>; continue():Promise<void>;
}
export function createHhSubmissionGuard(){
  let mode:'inactive'|'preview'|'apply'='inactive',limit=0,submissionAttempts=0,blockedSubmissionAttempts=0;
  const records:Array<{pathname:string;method:string;allowed:boolean;attempt:number}>=[];
  let interrupt!:()=>void;
  const blocked=new Promise<void>(resolve=>{interrupt=resolve;});
  return {
    activate(next:'preview'|'apply',responseLimit:number){
      if(mode!=='inactive')throw new Error('submission_guard_already_active');
      if(!Number.isInteger(responseLimit)||responseLimit<1||responseLimit>500)throw new Error('invalid_submission_limit');
      mode=next;limit=next==='apply'?responseLimit:0;
    },
    async handle(route:HhRequestRoute){
      const request=route.request();
      if(isLinkedInUrl(request.url())){await route.abort('blockedbyclient');return;}
      const url=new URL(request.url());
      const method=request.method().toUpperCase();
      let path=url.pathname;try{path=decodeURIComponent(path);}catch{}
      const applicationWrite=/(^|\.)hh\.ru$/i.test(url.hostname.replace(/\.$/,''))
        && !['GET','HEAD'].includes(method) && /vacancy_response|negotiations/i.test(path);
      if(mode!=='inactive'&&applicationWrite){
        const allowed=mode==='apply'&&submissionAttempts<limit;
        if(allowed)submissionAttempts++;else{blockedSubmissionAttempts++;interrupt();}
        if(records.length<100)records.push({pathname:url.pathname.slice(0,200),method:/^[A-Z]{1,20}$/.test(method)?method:'UNKNOWN',
          allowed,attempt:submissionAttempts});
        if(!allowed){await route.abort('blockedbyclient');return;}
      }
      // Reserving an attempt precedes dispatch. Failure/uncertainty must never refund it.
      await route.continue();
    },
    snapshot(){return {submissionAttempts,blockedSubmissionAttempts};},
    records(){return structuredClone(records);},blocked
  };
}
export async function createOctoHhSession(port:number,timeoutMs:number):Promise<OctoHhSession>{
  const {loadPlaywright}=require('../../../platform/browser/playwright.ts');
  const browser=await loadPlaywright().chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:Math.min(timeoutMs,10_000)});
  let context:any,page:any,network:any,canceled=false,disposeWatcher=()=>{},disconnected=false;
  const submissions=createHhSubmissionGuard();
  const guard=(route:any)=>submissions.handle(route);
  const assertActive=()=>{if(canceled)throw Object.assign(new Error('timeout'),{code:'timeout'});};
  try{
    context=browser.contexts()[0];if(!context)throw new Error('missing_profile_context');
    await context.route('**/*',guard);
    page=await context.newPage();
    // Service-worker interception otherwise bypasses Playwright routes. Scope
    // this setting to the new owned page before its first navigation.
    network=await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.setBypassServiceWorker',{bypass:true});
    browser.on('disconnected',()=>{disconnected=true;});
  }catch(error){await page?.close().catch(()=>{});await network?.detach().catch(()=>{});
    await context?.unroute('**/*',guard).catch(()=>{});await browser.close().catch(()=>{});throw error;}
  const guardedPage=new Proxy(page,{get(target,key){
    const value=Reflect.get(target,key);
    if(typeof value!=='function')return value;
    return (...args:any[])=>{
      if(['goto','reload','evaluate','click','fill','press','waitForSelector'].includes(String(key)))assertActive();
      if(key==='goto'&&isLinkedInUrl(String(args[0])))throw Object.assign(new Error('blocked_navigation'),{code:'linkedin_navigation_blocked'});
      return value.apply(target,args);
    };
  }});
  const facade=require('../auto-responder/browser.ts');
  const {detectHhAuthState}=require('../hh-auth/orchestrator.ts');
  const {authorizeHHPage}=require('../hh-auth/index.ts');
  const config=require('../orchestrator/config.ts');
  const {createCompanyStopListBrowserSource}=require('../../../../shared/company-stop-list.ts');
  const {mergeBlockedCompanies,GLOBAL_BLOCKED_COMPANIES}=require('../orchestrator/blocked-companies.ts');
  const counter=facade.createResponseCounter();
  const patch=(settings:OctoHhSettings)=>({coverText:settings.coverText,
    blockedCompanies:mergeBlockedCompanies(GLOBAL_BLOCKED_COMPANIES,settings.blockedCompanies),limit:settings.responseLimit});
  const reset=()=>guardedPage.evaluate((keys:Record<string,string>)=>{
    sessionStorage.removeItem(keys.running);sessionStorage.removeItem(keys.stop);sessionStorage.removeItem(keys.ids);
    sessionStorage.setItem(keys.count,'0');
  },{running:config.HH_AUTO_RESPONDER_RUNNING_KEY,stop:config.HH_AUTO_RESPONDER_STOP_REASON_KEY,
    ids:config.HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSE_IDS_KEY,count:config.HH_AUTO_RESPONDER_SUCCESSFUL_RESPONSES_KEY});
  return {
    async navigate(url,ms){assertActive();await guardedPage.goto(url,{waitUntil:'domcontentloaded',timeout:ms});},
    async authenticate(credentials:OctoHhTarget['hhAuthCredentials'],ms){
      return authenticateOctoHhPage(guardedPage,credentials,ms,
        {detect:detectHhAuthState,authorize:authorizeHHPage,check:assertActive});
    },
    async preview(settings){
      assertActive();submissions.activate('preview',settings.responseLimit);await reset();await facade.applyAutoResponderSettings(guardedPage,patch(settings));
      const source=createCompanyStopListBrowserSource()+'\n'+await readFile(config.INDEX_SCRIPT_PATH,'utf8');
      assertActive();const indexScriptInjected=await facade.ensureIndexScript(guardedPage,source,'Octo preview');
      return {opened:true,indexScriptInjected};
    },
    async apply(settings){
      assertActive();submissions.activate('apply',settings.responseLimit);await reset();
      const {openScenarioAndInjectIndex}=require('../orchestrator/scenario-runner.ts');
      const {closePageQuietly}=require('../../../platform/browser/page-utils.ts');
      const {withTimeout}=require('../orchestrator/runtime-utils.ts');
      // The scenario contract owns the single START click. Reuse this already guarded CDP page.
      const reusedBrowser={on:(...args:any[])=>browser.on(...args),contexts:()=>[{newPage:async()=>{assertActive();return guardedPage;}}]};
      const result=await openScenarioAndInjectIndex(port,settings.stackScenario,counter,
        {coverText:settings.coverText,blockedCompanies:patch(settings).blockedCompanies,responseLimit:settings.responseLimit,skipManualVacanciesCleanup:true},
        {applyAutoResponderSettings:facade.applyAutoResponderSettings,closePageQuietly,createCompanyStopListBrowserSource,
          detectHhAuthState,ensureIndexScript:facade.ensureIndexScript,installIndexReinjectWatcher:facade.installIndexReinjectWatcher,
          loadPlaywright:()=>({chromium:{connectOverCDP:async()=>{assertActive();return reusedBrowser;}}}),readFile,
          recordVacancyTransition:facade.recordVacancyTransition,runManualVacanciesCleanup:async()=>{throw new Error('cleanup_disabled');},withTimeout});
      disposeWatcher=result.disposeWatcher;return result.result;
    },
    watch:ms=>Promise.race([facade.waitForAutoResponderToFinish(guardedPage,ms,()=>disconnected,ms),
      submissions.blocked.then(()=>({submissionGuardStopped:true}))]),
    submissionGuard:()=>submissions.snapshot(),
    async outcome(){return {responseCount:await facade.getAutoResponderSuccessCount(page),stopReason:(await facade.getAutoResponderStopReason(page))?.reason};},
    cancel(){canceled=true;disposeWatcher();},
    async stop(){disposeWatcher();await facade.stopAutoResponder(page);},
    async dispose(){disposeWatcher();await page.close().catch(()=>{});await network.detach().catch(()=>{});
      await context.unroute('**/*',guard).catch(()=>{});
      // Playwright's CDP browser.close closes its transport, not the external Octo process.
      await browser.close().catch(()=>{});}
  };
}
