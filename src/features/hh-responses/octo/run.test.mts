import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runOctoHh,allowedHhScenario} from './run.mts';
import type {OctoHhRunInput,OctoHhSession,OctoHhSettings} from './run.mts';
import {isLinkedInUrl,linkedinRequestGuard,createHhSubmissionGuard,authenticateOctoHhPage} from './session.mts';
function input(port=14001):OctoHhRunInput{return {port,mode:'preview',responseLimit:1,timeoutMs:1000,target:{
  clientName:'Scoped fixture',market:'Ru',stackScenario:'https://hh.ru/search/vacancy?text=Go',coverText:'Fixture cover',
  blockedCompanies:[{id:'blocked',name:'Blocked employer'}],hhAuthCredentials:{login:'login-fixture',password:'secret-fixture'}
}};}
function fake(){
  const calls:string[]=[],settings:OctoHhSettings[]=[];
  let auth='logged_in',responses=0;
  const session:OctoHhSession={
    async navigate(){calls.push('navigate');},async authenticate(){calls.push('authenticate');return auth;},
    async preview(value){calls.push('preview');settings.push(value);return {opened:true,indexScriptInjected:true};},
    async apply(value){calls.push('apply');settings.push(value);return {opened:true,indexScriptInjected:true,startButtonClicked:true};},
    async watch(){calls.push('watch');responses=1;return {};},async outcome(){calls.push('outcome');return {responseCount:responses,stopReason:'limit_reached'};},
    submissionGuard:()=>({submissionAttempts:0,blockedSubmissionAttempts:0}),
    cancel(){calls.push('cancel');},async stop(){calls.push('stop');},async dispose(){calls.push('dispose');}
  };
  return {session,calls,settings,auth(value:string){auth=value;},deps:{async open(){calls.push('connect');return session;}}};
}
test('preview authenticates and injects settings but never starts, watches, sends, or invokes application cleanup',async()=>{
  const f=fake(),report=await runOctoHh(input(),f.deps);
  assert.equal(report.authenticated,true);assert.equal(report.indexScriptInjected,true);assert.equal(report.started,false);
  assert.equal(report.startAttempted,false);assert.equal(report.responseCount,0);assert.equal(report.stopReason,'preview_ready');
  assert.deepEqual(f.calls,['connect','navigate','authenticate','preview','cancel','dispose']);
  assert.equal(JSON.stringify(report).includes('secret-fixture'),false);assert.equal(JSON.stringify(report).includes('hh.ru'),false);
});
test('apply delegates one start and propagates exact cover, stop-list and limit before watching actual successes',async()=>{
  const f=fake(),value={...input(14002),mode:'apply' as const};
  const report=await runOctoHh(value,f.deps);
  assert.equal(report.started,true);assert.equal(report.responseCount,1);assert.equal(report.stopReason,'limit_reached');
  assert.equal(f.calls.filter(c=>c==='apply').length,1);assert.equal(f.calls.includes('preview'),false);
  assert.deepEqual(f.settings[0],{stackScenario:value.target.stackScenario,coverText:value.target.coverText,
    blockedCompanies:value.target.blockedCompanies,responseLimit:1});
  assert.ok(f.calls.indexOf('apply')<f.calls.indexOf('watch'));assert.equal(f.calls.filter(c=>c==='stop').length,1);
});
test('concurrent calls for the same CDP port refuse duplicate start',async()=>{
  const f=fake();let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  f.session.watch=async()=>{await gate;return {};};
  const value={...input(14003),mode:'apply' as const};
  const first=runOctoHh(value,f.deps);await Promise.resolve();
  const duplicate=await runOctoHh(value,f.deps);assert.equal(duplicate.stopReason,'run_already_active');
  assert.equal(f.calls.filter(c=>c==='connect').length,1);release();await first;
  assert.equal(f.calls.filter(c=>c==='apply').length,1);
});
test('timeout cancels pending work, stops an attempted application run and reports no provider message',async()=>{
  const f=fake();f.session.watch=()=>new Promise(()=>{});
  const report=await runOctoHh({...input(14004),mode:'apply',timeoutMs:20},f.deps);
  assert.equal(report.timedOut,true);assert.equal(report.stopReason,'timeout');assert.equal(report.started,true);
  assert.equal(f.calls.filter(c=>c==='stop').length,1);assert.equal(f.calls.at(-1),'dispose');
});
test('auth failure and credential errors never inject or start and are sanitized',async()=>{
  const f=fake();f.auth('captcha');const captcha=await runOctoHh({...input(14005),mode:'apply'},f.deps);
  assert.equal(captcha.authenticated,false);assert.equal(captcha.stopReason,'captcha_detected');assert.equal(f.settings.length,0);
  const g=fake();g.session.authenticate=async()=>{throw Object.assign(new Error('provider SQL password SECRET'),{code:'invalid_credentials'});};
  const failed=await runOctoHh({...input(14006),mode:'apply'},g.deps);
  assert.equal(failed.stopReason,'invalid_credentials');assert.equal(failed.started,false);assert.equal(JSON.stringify(failed).includes('SECRET'),false);
});
test('delayed CDP connection after timeout is disposed and cannot navigate or start',async()=>{
  const f=fake();let resolve!:(session:OctoHhSession)=>void;
  const opening=new Promise<OctoHhSession>(done=>{resolve=done;});
  const report=await runOctoHh({...input(14007),timeoutMs:10},{open:()=>opening});
  assert.equal(report.stopReason,'timeout');resolve(f.session);await Promise.resolve();await Promise.resolve();
  assert.deepEqual(f.calls,['cancel','dispose']);
});
test('LinkedIn domains and subdomains are denied before navigation; HH targets are scoped and validated',async()=>{
  for(const url of ['https://linkedin.com/feed','https://www.linkedin.com/in/person','http://a.b.linkedin.com/','https://linkedin.com./']){
    assert.equal(isLinkedInUrl(url),true);
    const calls:string[]=[];await linkedinRequestGuard({request:()=>({url:()=>url}),async abort(){calls.push('abort');},async continue(){calls.push('continue');}});
    assert.deepEqual(calls,['abort']);
  }
  assert.equal(isLinkedInUrl('https://linkedin.com.example.invalid/'),false);
  const f=fake(),value=input(14008);value.target.stackScenario='https://www.linkedin.com/jobs/';
  const report=await runOctoHh(value,f.deps);assert.equal(report.stopReason,'invalid_run_input');assert.deepEqual(f.calls,[]);
  assert.equal(allowedHhScenario('https://spb.hh.ru/search/vacancy?text=Go'),true);
  assert.equal(allowedHhScenario('https://user:password@hh.ru/search/vacancy'),false);
});

function request(url:string,method='POST',fail=false){
  const actions:string[]=[];
  return {actions,route:{request:()=>({url:()=>url,method:()=>method}),async abort(){actions.push('abort');},
    async continue(){actions.push('continue');if(fail)throw new Error('unknown_provider_result');}}};
}
test('submission guard reserves the first dispatch and blocks a second even after ambiguous failure',async()=>{
  const guard=createHhSubmissionGuard();guard.activate('apply',1);
  const first=request('https://hh.ru/applicant/vacancy_response?login=private-query','POST',true);
  await assert.rejects(guard.handle(first.route));assert.deepEqual(first.actions,['continue']);
  const second=request('https://spb.hh.ru/applicant/vacancy_response');await guard.handle(second.route);
  assert.deepEqual(second.actions,['abort']);assert.deepEqual(guard.snapshot(),{submissionAttempts:1,blockedSubmissionAttempts:1});
  assert.equal(JSON.stringify(guard.records()).includes('private-query'),false);
  assert.deepEqual(guard.records()[0],{pathname:'/applicant/vacancy_response',method:'POST',allowed:true,attempt:1});
});
test('GET/HEAD remain reads, negotiation writes are conservative, and preview allows no submission',async()=>{
  const guard=createHhSubmissionGuard();
  const login=request('https://hh.ru/account/login');await guard.handle(login.route);assert.deepEqual(login.actions,['continue']);
  guard.activate('preview',1);
  for(const method of ['GET','HEAD']){
    const read=request('https://hh.ru/applicant/negotiations',method);await guard.handle(read.route);assert.deepEqual(read.actions,['continue']);
  }
  for(const url of ['https://hh.ru/applicant/vacancy_response','https://hh.ru/api/negotiations/read-modal']){
    const write=request(url);await guard.handle(write.route);assert.deepEqual(write.actions,['abort']);
  }
  const linkedin=request('https://sub.linkedin.com/feed','GET');await guard.handle(linkedin.route);assert.deepEqual(linkedin.actions,['abort']);
  assert.deepEqual(guard.snapshot(),{submissionAttempts:0,blockedSubmissionAttempts:2});
});
test('report includes safe attempt counts and stops with guard outcome despite zero confirmed applications',async()=>{
  const f=fake();f.session.watch=async()=>({submissionGuardStopped:true});
  f.session.submissionGuard=()=>({submissionAttempts:1,blockedSubmissionAttempts:1});
  const report=await runOctoHh({...input(14009),mode:'apply'},f.deps);
  assert.equal(report.responseCount,0);assert.equal(report.submissionAttempts,1);assert.equal(report.blockedSubmissionAttempts,1);
  assert.equal(report.stopReason,'submission_attempt_limit_reached');assert.equal(f.calls.filter(c=>c==='stop').length,1);
});
test('Octo logged-out auth opens the explicit HH login page before the shared login workflow',async()=>{
  const calls:string[]=[],credentials={login:'fixture-login',password:'private-fixture'};let detected=0;
  const page={async goto(url:string){calls.push(url);}};
  const state=await authenticateOctoHhPage(page,credentials,1000,{check(){},
    async detect(){calls.push('detect');return {state:detected++?'logged_in':'logged_out'};},
    async authorize(actual,options){assert.equal(actual,page);assert.deepEqual(options.credentials,credentials);calls.push('authorize');}});
  assert.equal(state,'logged_in');assert.deepEqual(calls,['detect','https://hh.ru/account/login','authorize','detect']);
  for(const existing of ['logged_in','captcha']){
    const touched:string[]=[];
    assert.equal(await authenticateOctoHhPage({async goto(){touched.push('goto');}},credentials,1000,{check(){},
      async detect(){return {state:existing};},async authorize(){touched.push('authorize');}}),existing);
    assert.deepEqual(touched,[]);
  }
});
test('Octo login navigation respects cancellation before reusing auth or touching the login form',async()=>{
  const calls:string[]=[];let canceled=false;
  await assert.rejects(authenticateOctoHhPage({async goto(){calls.push('goto');canceled=true;}},{login:'fixture',password:'fixture'},1000,
    {check(){if(canceled)throw Object.assign(new Error('timeout'),{code:'timeout'});},
      async detect(){return {state:'logged_out'};},async authorize(){calls.push('authorize');}}),{code:'timeout'});
  assert.deepEqual(calls,['goto']);
});
