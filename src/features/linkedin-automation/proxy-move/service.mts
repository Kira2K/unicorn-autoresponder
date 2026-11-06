import { randomUUID } from 'node:crypto';
import {isIP} from 'node:net';
import { parseProxyInput } from '../../octo-access/proxy-input.mts';
import { manualProxyFingerprint } from '../../octo-access/manual-proxy-check.mts';
import { canEditProxy } from '../../octo-access/proxy-workflow.mts';
import type { OctoStore, ProxyInput, SavedProxy } from '../../octo-access/contracts.mts';
import type { LinkedInIntakeView } from '../console-intake/contracts.mts';
import { checkedCountry, destination, destinations, fail } from './contracts.mts';
import type { Move, MoveStore } from './contracts.mts';
export function createProxyMoveService(deps:{store:MoveStore;profiles:Pick<OctoStore,'list'>;
  account(id:number):Promise<LinkedInIntakeView>;allowed(id:number):boolean;hasDolphin(id:number):Promise<boolean>;
  client(id:number):Promise<{readyForInterviewInEnglishIn2Months?:unknown}>;
  check(input:ProxyInput):Promise<{ok:boolean;exit_ip?:string|null;country?:string|null}>;
  previousProxy(uuid:string):Promise<{saved?:SavedProxy;inline?:ProxyInput}>;now?:()=>number}) {
  const now=deps.now??Date.now;
  async function context(id:number) {
    if(!deps.allowed(id))fail('forbidden');
    const account=await deps.account(id),client=await deps.client(id);
    if(await deps.hasDolphin(id)&&!account.completionConfirmed)fail('forbidden');
    if(!account.linkedinAccountId||!account.hasLinkedIn||account.isBanned||account.registrationPending)fail('account_not_ready');
    const profiles=(await deps.profiles.list(id)).filter(p=>p.locale==='en'&&!p.deletion);
    if(profiles.length!==1||!profiles[0].uuid)fail('profile_not_ready');
    const profile=profiles[0],country=destination(client.readyForInterviewInEnglishIn2Months);
    return {account,profile,country,move:await deps.store.read(id,account.linkedinAccountId)};
  }
  function bound(move:Move,profile:Awaited<ReturnType<typeof context>>['profile']) {
    if(move.profileId!==profile.id||move.profileUuid!==profile.uuid)fail('binding_changed');
    return profile.proxyChange?.id===move.id&&profile.proxyChange.phase==='complete'&&profile.proxy?.uuid===profile.proxyChange.uuid;
  }
  function view(c:Awaited<ReturnType<typeof context>>) {
    const m=c.move,assigned=m&&bound(m,c.profile);
    return {country:c.country,destination:c.country?destinations[c.country]:undefined,profileId:c.profile.id,
      ...(m?{move:{id:m.id,country:m.country,destination:destinations[m.country],
        phase:m.phase==='completed'?'completed':assigned?'assigned':'assigning',completedAt:m.completedAt,pauseUntil:m.pauseUntil,
        error:c.profile.proxyChange?.id===m.id?c.profile.proxyChange.error:undefined}}:{}),
      canFinish:!!assigned&&canEditProxy(c.profile),canReplace:!!c.profile.proxy&&canEditProxy(c.profile)&&!m};
  }
  return {
    async status(id:number){return view(await context(id));},
    async replace(id:number,raw:unknown) {
      const c=await context(id),input=parseProxyInput(raw),fingerprint=manualProxyFingerprint(input);
      if(c.move){if(c.move.fingerprint!==fingerprint)fail('already_started');return view(c);}
      if(!c.country)fail('survey_required');
      if(!c.profile.proxy)fail('profile_not_ready');
      if(!canEditProxy(c.profile))fail('close_profile_first');
      const proof=await deps.check(input);
      if(!proof.ok||!proof.exit_ip||!isIP(proof.exit_ip))fail('check_failed');
      if(checkedCountry(proof.country)!==c.country)fail('country_mismatch');
      const previousProxy=await deps.previousProxy(c.profile.uuid!);
      const previous=previousProxy.saved||previousProxy.inline;
      if(!previous||previousProxy.saved&&previousProxy.saved.uuid!==c.profile.proxy.uuid)fail('binding_changed');
      if(manualProxyFingerprint(parseProxyInput(previous))===fingerprint)fail('same_connection');
      // Compare again after network I/O; the store atomically checks this revision and account binding.
      const current=await context(id);
      if(current.profile.revision!==c.profile.revision||current.country!==c.country||current.account.linkedinAccountId!==c.account.linkedinAccountId)fail('stale');
      const move:Move={id:randomUUID(),clientId:id,accountId:c.account.linkedinAccountId!,profileId:c.profile.id,
        profileUuid:c.profile.uuid!,country:c.country,fingerprint,previousProxy,phase:'assigning',createdAt:new Date(now()).toISOString(),
        proof:{exitIp:proof.exit_ip,country:c.country,checkedAt:new Date(now()).toISOString()}};
      await deps.store.begin(move,c.profile,input);
      return view(await context(id));
    },
    async finish(id:number,raw:unknown) {
      const c=await context(id),move=c.move;
      if(!move)fail('not_started');
      if(move.phase==='completed')return view(c);
      if(!raw||typeof raw!=='object'||(raw as {countryChanged?:unknown}).countryChanged!==true)fail('confirmation_required');
      if(!bound(move,c.profile))fail('assignment_pending');
      if(!canEditProxy(c.profile))fail('close_profile_first');
      await deps.store.finish(move,c.profile,new Date(now()).toISOString());
      return view(await context(id));
    }
  };
}
export type ProxyMoveService=ReturnType<typeof createProxyMoveService>;
