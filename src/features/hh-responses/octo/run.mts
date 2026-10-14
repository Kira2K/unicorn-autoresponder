import { createOctoHhSession } from './session.mts';

export interface OctoHhTarget {
  clientName: string; market: 'Ru' | 'En'; stackScenario: string; coverText: string;
  blockedCompanies: Array<{ id: string; name: string }>;
  hhAuthCredentials: { login: string; password: string };
}
export interface OctoHhRunInput {
  port: number; target: OctoHhTarget; mode: 'preview' | 'apply'; responseLimit: number; timeoutMs: number;
}
export interface OctoHhSettings {
  stackScenario: string; coverText: string; blockedCompanies: Array<{ id: string; name: string }>; responseLimit: number;
}
export interface OctoHhSession {
  navigate(url: string, timeoutMs: number): Promise<void>;
  authenticate(credentials: OctoHhTarget['hhAuthCredentials'], timeoutMs: number): Promise<string>;
  preview(settings: OctoHhSettings): Promise<{ opened: boolean; indexScriptInjected: boolean }>;
  apply(settings: OctoHhSettings): Promise<{ opened: boolean; indexScriptInjected: boolean; startButtonClicked: boolean }>;
  watch(timeoutMs: number): Promise<{ timedOut?: boolean; browserDisconnected?: boolean; pageClosed?: boolean; submissionGuardStopped?: boolean }>;
  outcome(): Promise<{ responseCount: number; stopReason?: string }>;
  submissionGuard(): {submissionAttempts:number;blockedSubmissionAttempts:number};
  cancel(): void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
export interface OctoHhRunDependencies { open(port: number, timeoutMs: number): Promise<OctoHhSession> }
export interface OctoHhRunReport {
  clientName: string; market: 'Ru' | 'En'; mode: 'preview' | 'apply'; responseLimit: number;
  authenticated: boolean; indexScriptInjected: boolean; started: boolean; startAttempted: boolean;
  responseCount: number; submissionAttempts:number; blockedSubmissionAttempts:number;
  stopReason: string; timedOut: boolean; cleanupFailed?: boolean;
}
const activePorts = new Set<number>();
const safeReasons = new Set(['preview_ready','preview_unavailable','auth_required','captcha_detected','auth_unknown',
  'invalid_credentials','missing_credentials','login_failed','session_not_persisted','selector_missing','run_already_active',
  'timeout','browser_disconnected','page_closed','scenario_unavailable','targets_processed','no_new_targets','limit_reached',
  'manual_targets_only','user_stop','orchestrator_stop_after_watch','orchestrator_idle_timeout',
  'hh_response_daily_limit_exceeded','vacancy_processing_error','vacancy_recovery_limit_exceeded','network_timeout',
  'resume_loop_detected','run_failed','response_limit_exceeded','linkedin_navigation_blocked','invalid_run_input',
  'submission_attempt_limit_reached','preview_submission_blocked']);
function reason(value: unknown, fallback = 'run_failed') { return typeof value==='string' && safeReasons.has(value) ? value : fallback; }
export function allowedHhScenario(value: string) {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password
    && /(^|\.)hh\.ru$/i.test(u.hostname)
    && /^(?:\/search\/vacancy(?:\/|$)|\/vacancy\/[^/]+(?:\/|$)|\/applicant\/vacancy_response(?:\/|$))/.test(u.pathname); }
  catch { return false; }
}
function valid(input: OctoHhRunInput) {
  return Number.isInteger(input.port) && input.port>0 && input.port<=65535 && ['preview','apply'].includes(input.mode)
    && Number.isInteger(input.responseLimit) && input.responseLimit>=1 && input.responseLimit<=500
    && Number.isSafeInteger(input.timeoutMs) && input.timeoutMs>0 && !!input.target.clientName
    && ['Ru','En'].includes(input.target.market) && allowedHhScenario(input.target.stackScenario)
    && typeof input.target.coverText==='string' && Array.isArray(input.target.blockedCompanies);
}
// Owns HH work on an already-running profile only. The caller owns Octo start/ordinary stop and reporting.
export async function runOctoHh(input: OctoHhRunInput,
  deps: OctoHhRunDependencies = { open: createOctoHhSession }): Promise<OctoHhRunReport> {
  const report: OctoHhRunReport = { clientName: input.target.clientName, market: input.target.market, mode: input.mode,
    responseLimit: input.responseLimit, authenticated:false,indexScriptInjected:false,started:false,startAttempted:false,
    responseCount:0,submissionAttempts:0,blockedSubmissionAttempts:0,stopReason:'run_failed',timedOut:false };
  if (!valid(input)) { report.stopReason='invalid_run_input'; return report; }
  if (activePorts.has(input.port)) { report.stopReason='run_already_active'; return report; }
  activePorts.add(input.port);
  const deadline=Date.now()+input.timeoutMs;
  let session:OctoHhSession|undefined, expired=false;
  const remaining=()=>Math.max(1,deadline-Date.now());
  async function bounded<T>(operation:Promise<T>):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try { return await Promise.race([operation,new Promise<T>((_,reject)=>{
      timer=setTimeout(()=>{expired=true;session?.cancel();reject(Object.assign(new Error('timeout'),{code:'timeout'}));},remaining());
    })]); } finally { if(timer)clearTimeout(timer); }
  }
  async function cleanup(operation:()=>Promise<void>) {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try { await Promise.race([operation(),new Promise<void>((_,reject)=>{timer=setTimeout(()=>reject(new Error('cleanup_timeout')),5000);})]); }
    catch { report.cleanupFailed=true; } finally { if(timer)clearTimeout(timer); }
  }
  try {
    const opening=deps.open(input.port,remaining());
    // A delayed CDP connection must not create an abandoned automation session after timeout.
    void opening.then(async opened=>{if(expired){opened.cancel();await opened.dispose().catch(()=>{});}}).catch(()=>{});
    session=await bounded(opening);
    await bounded(session.navigate(input.target.stackScenario,remaining()));
    const auth=await bounded(session.authenticate(input.target.hhAuthCredentials,remaining()));
    if(auth!=='logged_in'){report.stopReason=auth==='captcha'?'captcha_detected':auth==='logged_out'?'auth_required':'auth_unknown';return report;}
    report.authenticated=true;
    const settings:OctoHhSettings={stackScenario:input.target.stackScenario,coverText:input.target.coverText,
      blockedCompanies:structuredClone(input.target.blockedCompanies),responseLimit:input.responseLimit};
    if(input.mode==='preview'){
      const prepared=await bounded(session.preview(settings));report.indexScriptInjected=prepared.indexScriptInjected;
      report.stopReason=prepared.opened&&prepared.indexScriptInjected?'preview_ready':'preview_unavailable';return report;
    }
    report.startAttempted=true;
    const started=await bounded(session.apply(settings));
    report.indexScriptInjected=started.indexScriptInjected;report.started=started.startButtonClicked;
    if(!started.opened||!started.startButtonClicked){report.stopReason='scenario_unavailable';return report;}
    const watched=await bounded(session.watch(remaining()));
    if(watched.timedOut){report.timedOut=true;report.stopReason='timeout';}
    else if(watched.browserDisconnected)report.stopReason='browser_disconnected';
    else if(watched.pageClosed)report.stopReason='page_closed';
    const outcome=await bounded(session.outcome());
    report.responseCount=Number.isSafeInteger(outcome.responseCount)&&outcome.responseCount>=0?outcome.responseCount:0;
    if(report.responseCount>input.responseLimit)report.stopReason='response_limit_exceeded';
    else if(!report.timedOut&&!watched.browserDisconnected&&!watched.pageClosed)report.stopReason=reason(outcome.stopReason,'scenario_unavailable');
  } catch(error){report.stopReason=reason((error as {code?:unknown})?.code);report.timedOut=report.stopReason==='timeout';}
  finally {
    session?.cancel();
    if(session){
      if(report.startAttempted)await cleanup(()=>session!.stop());
      // Read actual successes even if watching timed out; never infer success from visited vacancies.
      if(report.startAttempted)await cleanup(async()=>{
        const outcome=await session!.outcome();
        if(Number.isSafeInteger(outcome.responseCount)&&outcome.responseCount>=0)report.responseCount=outcome.responseCount;
        if(report.responseCount>input.responseLimit)report.stopReason='response_limit_exceeded';
      });
      const guard=session.submissionGuard();
      report.submissionAttempts=guard.submissionAttempts;report.blockedSubmissionAttempts=guard.blockedSubmissionAttempts;
      if(guard.blockedSubmissionAttempts>0)report.stopReason=input.mode==='preview'?'preview_submission_blocked':'submission_attempt_limit_reached';
      await cleanup(()=>session!.dispose());
    }
    activePorts.delete(input.port);
  }
  return report;
}
