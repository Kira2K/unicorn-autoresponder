import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { WebClient } from '../web-console/backend/types.ts';
import { OctoError } from './contracts.mts';
import type { Locale, ManagedProfile, OctoConfig, OctoStore } from './contracts.mts';
import { generateProfilePassword } from './password.mts';
const { requiredLocalesForMarket, getRequiredClientDataIssues, buildProfileName, transliterate } = createRequire(import.meta.url)(
  '../web-console/backend/dolphin-profile-provisioning.ts') as {
    requiredLocalesForMarket(value: unknown): Locale[];
    getRequiredClientDataIssues(client: WebClient, options: { requireCalendarEmail: boolean }): unknown[];
    buildProfileName(client: WebClient, locale: Locale): string; transliterate(value: string): string;
  };
export function createOctoService({ store, config, getClient, now = Date.now, password = generateProfilePassword,
  canGrant = () => true }: {
  store: OctoStore; config: OctoConfig; getClient(id: number): Promise<WebClient>; now?: () => number;
  password?: () => string; canGrant?: (uuid: string) => boolean;
}) {
  const allow = (id: number) => {
    if (config.enabled === false || !config.allowedClientIds.has(id)) throw new OctoError('forbidden', 403);
  };
  const client = async (id: number) => { allow(id); return getClient(id); };
  const snapshot = (p: ManagedProfile) => ({ id: p.id, locale: p.locale, title: p.original.title,
    phase: p.grant && p.grant.phase !== 'complete' ? p.grant.phase : p.phase,
    grantId: p.grant?.id, error: p.grant?.error ?? p.error });
  return {
    allowed: (id: number) => config.enabled !== false && config.allowedClientIds.has(id),
    async status(clientId: number) {
      const c = await client(clientId), profiles = await store.list(clientId);
      return { profiles: profiles.map(snapshot), requiredLocales: requiredLocalesForMarket(c.market),
        provisioning: { phase: profiles.some(p => p.phase === 'blocked') ? 'blocked'
          : profiles.some(p => p.phase !== 'ready') ? 'preparing' : 'ready',
          error: profiles.find(p => p.phase === 'blocked')?.error } };
    },
    async ensure(clientId: number, ownProxy = false) {
      const c = await client(clientId);
      if (getRequiredClientDataIssues(c, { requireCalendarEmail: true }).length)
        throw new OctoError('octo_client_data_required', 409);
      const locales = requiredLocalesForMarket(c.market);
      for (let attempt = 0; attempt < 20; attempt++) {
        const existing = await store.list(), taken = new Set(existing.map(p => p.password));
        const missing = locales.filter(locale => !existing.some(p => p.clientId === clientId && p.locale === locale));
        if (!missing.length) return this.status(clientId);
        const drafts = missing.map(locale => {
          let secret = password(), tries = 0;
          while (taken.has(secret) && tries++ < 100) secret = password();
          if (!/^\d{5}$/.test(secret) || taken.has(secret)) throw new OctoError('octo_password_unavailable', 503);
          taken.add(secret);
          const operationId = randomUUID();
          const name = c.calendarEmail.toLowerCase() === 'alex.octo@example.com' ? 'alex'
            : c.calendarEmail.toLowerCase() === 'bob.octo@example.com' ? 'bob' : '';
          return { clientId, locale, operationId, password: secret, createdAt: now(), ownProxy,
            phase: 'queued' as const,
            proxyName: `${transliterate(c.firstName)} | {profileId} | ${transliterate(c.lastName)} | ${c.commonChatId} | ${c.primaryStack} En`,
            original: { title: buildProfileName(c, locale).slice(0, 90), description: `unicorn-octo:${operationId}`,
              tags: [], start_pages: name ? [`https://en.wikipedia.org/w/index.php?search=${name}`] : [] } };
        });
        try { await store.reserve(drafts); return this.status(clientId); }
        catch (error) { if ((error as { code?: string }).code !== 'octo_password_conflict') throw error; }
      }
      throw new OctoError('octo_password_unavailable', 503);
    },
    async acquire(clientId: number, profileId: number) {
      allow(clientId);
      if (!Number.isSafeInteger(profileId) || profileId < 1) throw new OctoError('invalid_profile_id', 400);
      for (let attempt = 0; attempt < 4; attempt++) {
        const p = await store.get(profileId);
        if (!p || p.clientId !== clientId) throw new OctoError('not_found', 404);
        if (p.grant && ['preparing', 'granted'].includes(p.grant.phase)) {
          if (p.grant.expiresAt && p.grant.expiresAt <= now()) throw new OctoError('octo_cleanup_pending', 409);
          return { id: p.grant.id, phase: p.grant.phase };
        }
        if (p.grant && p.grant.phase !== 'complete') throw new OctoError('octo_cleanup_pending', 409);
        if (p.phase !== 'ready' || !p.uuid) throw new OctoError('octo_profile_not_ready', 409);
        if (!canGrant(p.uuid)) throw new OctoError('octo_listener_unavailable', 503);
        const events = await store.events(p.uuid);
        p.grant = { id: randomUUID(), phase: 'preparing', alias: `John Doe ${randomUUID().slice(0, 8)}`,
          createdAt: now(), eventsAfter: events.at(-1)?.seq ?? 0, original: structuredClone(p.original),
          originalProxyTitle: p.proxy?.title };
        try { await store.save(p); return { id: p.grant.id, phase: p.grant.phase }; }
        catch (error) { if ((error as { code?: string }).code !== 'octo_stale_revision') throw error; }
      }
      throw new OctoError('octo_busy', 409);
    },
    async grant(clientId: number, grantId: string) {
      allow(clientId);
      const p = (await store.list(clientId)).find(p => p.grant?.id === grantId), g = p?.grant;
      if (!p || !g) throw new OctoError('not_found', 404);
      return { id: g.id, profileId: p.id, phase: g.phase, alias: g.alias, expiresAt: g.expiresAt, error: g.error,
        ...(g.phase === 'granted' && g.expiresAt! > now() ? { password: p.password, guest: { ...config.guest } } : {}) };
    }
  };
}
export type OctoService = ReturnType<typeof createOctoService>;
