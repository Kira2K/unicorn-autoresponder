import { randomUUID } from 'node:crypto';
import { OctoError } from './contracts.mts';
import type { OctoStore, ProxyInput, ManagedProfile } from './contracts.mts';
import type { WebClient } from '../web-console/backend/types.ts';
import type { ProxyResult, ProxyLocation } from './proxy-checker.mts';
import type { LocationOption } from './nodemaven-locations.mts';
import { parseOwnSocksProxy } from './own-proxy-string.mts';
import { parseProxyInput } from './proxy-input.mts';
import { ensureClientPassword } from './client-password.mts';
import { assertClientReady, profileRules } from './profile-reservation.mts';
import type { ProxySetup } from './onboarding-contracts.mts';
import type { CheckerDevelopmentHelp } from './checker-development-help.mts';
import {expertProxy} from './proxy-workflow.mts';
import {checkManualProxy} from './manual-proxy-check.mts';
import type {ProxyConnectivityResult} from './manual-proxy-check.mts';

export interface OnboardingDependencies {
  manualCheck?: (proxy:ProxyInput)=>Promise<ProxyConnectivityResult>;
  developmentHelp?: () => Promise<CheckerDevelopmentHelp | undefined>;
  checker: { check(proxy: string): Promise<ProxyResult>; best(key: string, location: ProxyLocation): Promise<ProxyResult>; cancel?(): void };
  catalogue: { list(key: string, level: 'countries'|'regions'|'cities', country?: string, region?: string): Promise<LocationOption[]>;
    validate(key: string, location: ProxyLocation): Promise<ProxyLocation> };
  dolphin: { list(clientId: number): Promise<Array<{ id: number; locale: string; hasProxy: boolean }>>;
    proxy(profileId: number): Promise<ProxyInput | undefined> };
}
export const setupBusy = (setup?: ProxySetup) => !!setup && !['complete','blocked','unknown'].includes(setup.phase);
function assertManualProfiles(profiles:ManagedProfile[]){
 if(profiles.some(p=>p.deletion))throw new OctoError('octo_profile_deleting',409);
 if(profiles.some(p=>p.pending||p.proxyChange?.pending))throw new OctoError('octo_setup_outcome_unknown',409);
 const en=profiles.find(p=>p.locale==='en');
 if(en&&expertProxy(en))throw new OctoError('octo_proxy_managed_by_expert',403);
 if(en?.grant&&en.grant.phase!=='complete')throw new OctoError('octo_profile_not_idle',409);
}
export function createOnboardingService({ store, getClient, now = Date.now, ...deps }: OnboardingDependencies & {
  store: OctoStore; getClient(id: number): Promise<WebClient>; now?: () => number;
}) {
  return {
    async status(clientId: number) {
      const state = await store.clientState(clientId), operation = state?.setup;
      return { phase: operation?.phase ?? 'idle', id: operation?.id, error: operation?.error,
        score: operation?.score, source: operation?.source, hasNodeMavenKey: !!state?.nodeMavenKey,
        check:operation?.verifiedProxy?{exitIp:operation.verifiedProxy.exitIp,country:operation.verifiedProxy.country,checkedAt:operation.verifiedProxy.checkedAt}:undefined,
        developmentHelp: await deps.developmentHelp?.(),
        dolphinProfiles: await deps.dolphin.list(clientId) };
    },
    async saveKey(clientId: number, key: unknown) {
      if (typeof key !== 'string' || !key.trim() || key.trim().length > 512 || /[\r\n]/.test(key))
        throw new OctoError('octo_nodemaven_key_invalid', 400);
      const state = await ensureClientPassword(store, clientId);
      if (setupBusy(state.setup)) throw new OctoError('octo_setup_busy', 409);
      state.nodeMavenKey = key.trim(); await store.saveClientState(state);
      return { saved: true };
    },
    async locations(clientId: number, level: unknown, country?: unknown, region?: unknown) {
      if (!['countries','regions','cities'].includes(String(level)) || (country !== undefined && typeof country !== 'string') ||
        (region !== undefined && typeof region !== 'string')) throw new OctoError('octo_proxy_location_invalid', 400);
      const key = (await store.clientState(clientId))?.nodeMavenKey;
      if (!key) throw new OctoError('octo_nodemaven_key_required', 409);
      return { items: await deps.catalogue.list(key, level as 'countries'|'regions'|'cities', country as string | undefined, region as string | undefined) };
    },
    async start(clientId: number, raw: unknown) {
      const client = await getClient(clientId); assertClientReady(client);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OctoError('octo_setup_input_invalid', 400);
      const value = raw as Record<string, unknown>;
      const source = value.source as ProxySetup['source'];
      if (!['none','own','nodemaven','dolphin','manual'].includes(source)) throw new OctoError('octo_setup_input_invalid', 400);
      if (!['none','manual'].includes(source) && await deps.developmentHelp?.()) throw new OctoError('octo_checker_local_unavailable', 503);
      let state = await ensureClientPassword(store, clientId);
      const retryManualConfirmation=source==='manual'&&state.setup?.source==='manual'&&state.setup.phase==='awaiting_confirmation';
      if (setupBusy(state.setup)&&!retryManualConfirmation) return this.status(clientId);
      if (state.setup?.phase === 'unknown'&&!(source==='manual'&&state.setup.source==='manual'&&state.setup.error==='octo_proxy_check_unknown')) throw new OctoError('octo_setup_outcome_unknown', 409);
      const existing = await store.list(clientId);
      if (existing.some(p => p.deletion)) throw new OctoError('octo_profile_deleting', 409);
      const missing = profileRules.requiredLocalesForMarket(client.market).filter(locale => !existing.some(p => p.locale === locale));
      if (!missing.length&&source!=='manual') return this.status(clientId);
      if(source==='manual')assertManualProfiles(existing);
      if (source!=='manual'&&missing.includes('en') === (source === 'none') || source==='manual'&&!profileRules.requiredLocalesForMarket(client.market).includes('en')) throw new OctoError('octo_proxy_setup_required', 409);
      const dolphinProfiles = await deps.dolphin.list(clientId);
      if (dolphinProfiles.length && value.confirmDolphin !== true) throw new OctoError('octo_dolphin_confirmation_required', 409);
      const setup: ProxySetup = { id: randomUUID(), source, phase: source==='none' ? 'provisioning' : 'queued',
        createdAt: now(), confirmDolphin: value.confirmDolphin === true };
      if (source === 'own') setup.input = parseOwnSocksProxy(value.proxy as string);
      if (source === 'manual') {
        setup.input = parseProxyInput(value.proxy);
        // Validate before publishing work, so an older worker cannot apply its score threshold.
        // No SQL transaction or external Octo mutation is held across this bounded request.
        const input=setup.input;
        setup.verifiedProxy=await checkManualProxy(input,uri=>deps.manualCheck?deps.manualCheck(input):deps.checker.check(uri),now);
        const current=await store.clientState(clientId);
        if(!current||current.revision!==state.revision)throw new OctoError('octo_stale_revision',409);
        assertManualProfiles(await store.list(clientId));
        if(retryManualConfirmation)setup.id=state.setup!.id;
        setup.phase='provisioning';
      }
      if (source === 'dolphin') {
        const id = Number(value.profileId);
        if (!Number.isSafeInteger(id) || !dolphinProfiles.some(p => p.id === id && p.hasProxy)) throw new OctoError('not_found', 404);
        const proxy = await deps.dolphin.proxy(id);
        if (!proxy) throw new OctoError('octo_dolphin_proxy_missing', 409);
        if (proxy.type !== 'socks5') throw new OctoError('octo_proxy_socks5_required', 409);
        setup.input = proxy;
      }
      if (source === 'nodemaven') {
        if (!state.nodeMavenKey) throw new OctoError('octo_nodemaven_key_required', 409);
        setup.location = await deps.catalogue.validate(state.nodeMavenKey, value.location as ProxyLocation);
      }
      state.setup = setup;
      try { await store.saveClientState(state); }
      catch (error) {
        if ((error as {code?: string}).code !== 'octo_stale_revision' || !setupBusy((await store.clientState(clientId))?.setup)) throw error;
      }
      return this.status(clientId);
    },
    async accept(clientId: number, id: string, accept: unknown) {
      const state = await store.clientState(clientId), setup = state?.setup;
      if (!state || !setup || setup.id !== id) throw new OctoError('not_found', 404);
      if (setup.phase === 'provisioning' && setup.acceptLowScore === true) return this.status(clientId);
      if (accept !== true || setup.phase !== 'awaiting_confirmation' || !setup.input ||
        !['own','dolphin'].includes(setup.source) || typeof setup.score !== 'number' || setup.score >= 70)
        throw new OctoError('octo_confirmation_not_available', 409);
      setup.acceptLowScore = true; setup.phase = 'provisioning'; await store.saveClientState(state);
      return this.status(clientId);
    }
  };
}
