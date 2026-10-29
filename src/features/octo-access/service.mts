import { randomUUID } from 'node:crypto';
import type { WebClient } from '../web-console/backend/types.ts';
import { OctoError } from './contracts.mts';
import type { CloudApi, Locale, ManagedProfile, OctoConfig, OctoStore, ProxyInput } from './contracts.mts';
import { generateProfilePassword } from './password.mts';
import { parseProxyInput } from './proxy-input.mts';
import { canEditProxy, proxyBusy, expertProxy } from './proxy-workflow.mts';
import { octoClientAllowed } from './access-policy.mts';
import { profileRules, reserveClientProfiles } from './profile-reservation.mts';
import { createOnboardingService } from './onboarding-service.mts';
import { readGrantCandidate } from './acquire-profile.mts';
import type { OnboardingDependencies } from './onboarding-service.mts';
import {manualProxyFingerprint} from './manual-proxy-check.mts';
const { requiredLocalesForMarket } = profileRules;
export function createOctoService({ store, config, getClient, now = Date.now, password = generateProfilePassword,
  canGrant = () => true, onboarding, readProfileProxy }: {
  store: OctoStore; config: OctoConfig; getClient(id: number): Promise<WebClient>; now?: () => number;
  password?: () => string; canGrant?: (uuid: string) => boolean;
  onboarding?: OnboardingDependencies;
  readProfileProxy?: CloudApi['readProfileProxy'];
}) {
  const allow = (id: number) => {
    if (!octoClientAllowed(config, id)) throw new OctoError('forbidden', 403);
  };
  const client = async (id: number) => { allow(id); return getClient(id); };
  const unavailable = async (): Promise<never> => { throw new OctoError('octo_checker_configuration_required', 503); };
  const setup = createOnboardingService({ store, getClient: client, now, ...(onboarding ?? {
    checker: { check: unavailable, best: unavailable }, catalogue: { list: unavailable, validate: unavailable },
    dolphin: { list: async () => [], proxy: unavailable }
  }) });
  const snapshot = (p: ManagedProfile, connection?: ProxyInput, credentialsError?: string,staff=false) => ({ id: p.id, locale: p.locale, title: p.original.title,
    phase: p.deletion ? (p.deletion.phase === 'blocked' ? 'deletion_blocked' : 'deleting') : p.grant && p.grant.phase !== 'complete' ? p.grant.phase : p.phase,
    grantId: p.deletion ? undefined : p.grant?.id, error: p.deletion?.error ?? p.grant?.error ?? p.error,
    canEditProxy: canEditProxy(p)&&(!expertProxy(p)||staff), proxy: { configured: !!p.proxy && !proxyBusy(p),
      isMadeByExpert:expertProxy(p),canViewCredentials:!expertProxy(p)||staff,
      phase: p.proxyChange?.phase, error: p.proxyChange?.error,...(!expertProxy(p)||staff?{type:p.proxy?.type,host:p.proxy?.host,port:p.proxy?.port}:{}),
      ...(connection ? { ...connection, credentialsLoaded: true } : {}), ...(credentialsError ? { credentialsError } : {}) } });
  return {
    allowed: (id: number) => octoClientAllowed(config, id),
    async status(clientId: number, options: { proxyCredentials?: boolean; locales?: readonly Locale[];staff?:boolean } = {}) {
      const c = await client(clientId), profiles = await store.list(clientId);
      const selected = options.locales ? profiles.filter(p => options.locales!.includes(p.locale)) : profiles;
      const snapshots = await Promise.all(selected.map(async p => {
        let canAcquire=false;
        try{await readGrantCandidate(store,clientId,p.id,now);canAcquire=true;}catch{/* Owner-scoped read; acquire repeats the authoritative checks. */}
        const view=(connection?:ProxyInput,credentialsError?:string)=>({...snapshot(p,connection,credentialsError,options.staff),canAcquire});
        if (!options.proxyCredentials || expertProxy(p)&&!options.staff || !p.uuid || !p.proxy || p.deletion || proxyBusy(p)) return view();
        try {
          if (!readProfileProxy) throw new Error('proxy_reader_unavailable');
          const actual = await readProfileProxy(p.uuid);
          if (!actual.saved || actual.saved.uuid.replaceAll('-', '').toLowerCase() !== p.proxy.uuid.replaceAll('-', '').toLowerCase())
            throw new Error('proxy_binding_changed');
          return view(parseProxyInput(actual.saved));
        } catch {
          return view(undefined, 'octo_proxy_credentials_unavailable');
        }
      }));
      return { profiles: snapshots, requiredLocales: requiredLocalesForMarket(c.market),
        onboarding: await setup.status(clientId),
        provisioning: { phase: profiles.some(p => p.phase === 'blocked') ? 'blocked'
          : profiles.some(p => p.phase !== 'ready') ? 'preparing' : 'ready',
          error: profiles.find(p => p.phase === 'blocked')?.error } };
    },
    async reserve(clientId: number, ownProxy = false) {
      const c = await client(clientId);
      const existing = await store.list(clientId), operation = (await store.clientState(clientId))?.setup;
      if (existing.some(p => p.deletion)) throw new OctoError('octo_profile_deleting', 409);
      const requiredLocales = operation?.source==='direct'&&operation.locales?.length?operation.locales:requiredLocalesForMarket(c.market);
      const missing = requiredLocales.filter(locale => !existing.some(p => p.locale === locale));
      const explicitSetup = operation?.phase === 'provisioning' &&
        (operation.source === 'direct' || (operation.source === 'manual' && !!operation.input&&operation.verifiedProxy?.fingerprint===manualProxyFingerprint(operation.input)));
      if(operation?.source==='manual'&&!explicitSetup&&missing.length)throw new OctoError('octo_proxy_setup_required',409);
      if (missing.includes('en') && !explicitSetup && (!operation || operation.phase !== 'provisioning' || operation.source === 'none' ||
        !operation.input || typeof operation.score !== 'number' ||
        (operation.source !== 'nodemaven' && operation.score < 70 && !operation.acceptLowScore)))
        throw new OctoError('octo_proxy_setup_required', 409);
      if (missing.length && onboarding && (await onboarding.dolphin.list(clientId)).length && !operation?.confirmDolphin)
        throw new OctoError('octo_dolphin_confirmation_required', 409);
      return reserveClientProfiles(store, c, ownProxy || !!explicitSetup, now, password,requiredLocales);
    },
    async ensure(clientId: number, ownProxy = false) {
      await this.reserve(clientId, ownProxy);
      return this.status(clientId);
    },
    async startOnboarding(clientId: number, input: unknown) { await client(clientId); await setup.start(clientId, input); return this.status(clientId); },
    async continueOnboarding(clientId: number, id: string, accept: unknown) { await client(clientId); await setup.accept(clientId, id, accept); return this.status(clientId); },
    async saveNodeMavenKey(clientId: number, key: unknown) { await client(clientId); return setup.saveKey(clientId, key); },
    async locations(clientId: number, level: unknown, country?: unknown, region?: unknown) { await client(clientId); return setup.locations(clientId, level, country, region); },
    async acquire(clientId: number, profileId: number) {
      allow(clientId);
      for (let attempt = 0; attempt < 4; attempt++) {
        const { profile: p, existing } = await readGrantCandidate(store, clientId, profileId, now);
        if (existing) return existing;
        if (!canGrant(p.uuid!)) throw new OctoError('octo_listener_unavailable', 503);
        const events = await store.events(p.uuid!);
        p.grant = { id: randomUUID(), phase: 'preparing', alias: `John Doe ${randomUUID().slice(0, 8)}`,
          createdAt: now(), eventsAfter: events.at(-1)?.seq ?? 0, original: structuredClone(p.original),
          originalProxyTitle: p.proxy?.title };
        try { await store.save(p); return { id: p.grant.id, phase: p.grant.phase }; }
        catch (error) { if ((error as { code?: string }).code !== 'octo_stale_revision') throw error; }
      }
      throw new OctoError('octo_busy', 409);
    },
    async queueProxy(clientId: number, profileId: number, input: unknown, operationId: string = randomUUID(),isMadeByExpert=false) {
      allow(clientId);
      if (!Number.isSafeInteger(profileId) || profileId < 1) throw new OctoError('invalid_profile_id', 400);
      const p = await store.get(profileId);
      if (!p || p.clientId !== clientId) throw new OctoError('not_found', 404);
      if (p.deletion) throw new OctoError('octo_profile_deleting', 409);
      if(expertProxy(p)&&!isMadeByExpert)throw new OctoError('octo_proxy_managed_by_expert',403);
      const connection = parseProxyInput(input);
      if (proxyBusy(p) && JSON.stringify(p.proxyChange?.input) === JSON.stringify(connection)) return;
      if (!canEditProxy(p) || !p.uuid) throw new OctoError('octo_profile_not_idle', 409);
      p.proxyChange = { id: operationId, phase: 'queued', input: connection,isMadeByExpert,
        title: `${p.original.title} | ${p.uuid}`.slice(0, 255) };
      await store.save(p);
    },
    async saveProxy(clientId: number, profileId: number, input: unknown,isMadeByExpert=false) {
      const operation = (await store.clientState(clientId))?.setup;
      if (operation && !['complete','blocked','unknown'].includes(operation.phase))
        throw new OctoError('octo_setup_busy', 409);
      if(!isMadeByExpert&&operation?.source==='manual'){
        const profile=await store.get(profileId);
        if(!profile||profile.clientId!==clientId)throw new OctoError('not_found',404);
        if(profile.locale!=='en')throw new OctoError('octo_proxy_setup_required',409);
        await setup.start(clientId,{source:'manual',proxy:input});return this.status(clientId);
      }
      await this.queueProxy(clientId, profileId, input,undefined,isMadeByExpert);
      return this.status(clientId,{staff:isMadeByExpert});
    },
    async grant(clientId: number, grantId: string) {
      allow(clientId);
      const p = (await store.list(clientId)).find(p => p.grant?.id === grantId), g = p?.grant;
      if (!p || !g) throw new OctoError('not_found', 404);
      if (p.deletion) throw new OctoError('octo_profile_deleting', 409);
      return { id: g.id, profileId: p.id, phase: g.phase, alias: g.alias, expiresAt: g.expiresAt, error: g.error,
        ...(g.phase === 'granted' && g.expiresAt! > now() ? { password: p.password, guest: { ...config.guest } } : {}) };
    }
  };
}
export type OctoService = ReturnType<typeof createOctoService>;
