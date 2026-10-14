// Mock adapters for contract/UI tests only. Production always uses PostgreSQL + cloud API.
import { randomUUID } from 'node:crypto';
import { OctoError } from './contracts.mts';
import type { CloudApi, ManagedProfile, OctoConfig, OctoStore, StoredEvent, StreamState } from './contracts.mts';
import type { Profile } from '../octo-access-test/contract.mts';
import type { ActionPage } from '../octo-access-test/action-log.mts';
import type { WebClient } from '../web-console/backend/types.ts';
import type { ClientState } from './onboarding-contracts.mts';
import { validateClient } from './postgres-clients.mts';
import { initialDeletion, isDeletionEvent, setupUsesProfile } from './deletion-state.mts';
export function createMemoryStore(): OctoStore {
  const profiles = new Map<number, ManagedProfile>(), events: StoredEvent[] = [];
  const clients = new Map<number, ClientState>();
  let stream: StreamState = { coverageSince: 0 }, nextId = 1, nextSeq = 1, held = false;
  const normalize = (id: string) => id.replaceAll('-', '').toLowerCase();
  return {
    async checkSchema() {},
    async clientState(id) { return structuredClone(clients.get(id)); },
    async clientStates() { return structuredClone([...clients.values()].sort((a,b) => a.clientId-b.clientId)); },
    async claimClientPassword(clientId, candidate) {
      validateClient({ clientId, password: candidate, revision: 1 });
      const existing = clients.get(clientId);
      if (existing) return structuredClone(existing);
      if ([...clients.values()].some(c => c.password === candidate)) throw new OctoError('octo_password_conflict');
      const state = { clientId, password: candidate, revision: 1 }; clients.set(clientId, state);
      return structuredClone(state);
    },
    async saveClientState(input) {
      validateClient(input);
      const existing = clients.get(input.clientId);
      if (existing?.revision !== input.revision || existing?.password !== input.password) throw new OctoError('octo_stale_revision');
      const next = structuredClone({ ...input, revision: input.revision+1 }); clients.set(input.clientId, next);
      return structuredClone(next);
    },
    async list(clientId) { return structuredClone([...profiles.values()].filter(p => clientId === undefined || p.clientId === clientId)); },
    async get(id) { return structuredClone(profiles.get(id)); },
    async reserve(drafts) {
      if (!drafts.length) return [];
      if (drafts.some(d => d.clientId !== drafts[0].clientId || !['ru','en'].includes(d.locale) ||
          typeof d.password!=='string' || !/^\d{5}$/.test(d.password)) ||
          new Set(drafts.map(d => d.locale)).size !== drafts.length) throw new OctoError('octo_invalid_state');
      const client = await this.claimClientPassword(drafts[0].clientId, drafts[0].password);
      for (const draft of drafts) {
        if ([...profiles.values()].some(p => p.clientId === draft.clientId && p.locale === draft.locale)) continue;
        const p = { ...structuredClone(draft), password: client.password, id: nextId++, revision: 0 }; profiles.set(p.id, p);
      }
      return this.list(drafts[0]?.clientId);
    },
    async save(input) {
      if (profiles.get(input.id)?.revision !== input.revision) throw new OctoError('octo_stale_revision');
      const existing = profiles.get(input.id);
      if (existing?.clientId !== input.clientId || existing?.locale !== input.locale ||
          clients.get(input.clientId)?.password !== input.password) throw new OctoError('octo_invalid_state');
      const p = structuredClone({ ...input, revision: input.revision + 1 }); profiles.set(p.id, p); return structuredClone(p);
    },
    async remove(input) {
      const current = profiles.get(input.id);
      if (!current) return;
      if (!input.uuid || input.deletion?.phase !== 'purge' || current.deletion?.phase !== 'purge' || current.revision !== input.revision ||
          current.clientId !== input.clientId || current.uuid !== input.uuid) throw new OctoError('octo_stale_revision');
      const client = clients.get(current.clientId);
      if (client && setupUsesProfile(client.setup, current)) { delete client.setup; client.revision++; }
      for (let i = events.length - 1; i >= 0; i--) if (events[i].profileId === normalize(input.uuid)) events.splice(i, 1);
      profiles.delete(input.id);
    },
    async events(uuid, after = 0) { return structuredClone(events.filter(e => e.profileId === normalize(uuid) && e.seq > after)); },
    async stream() { return structuredClone(stream); },
    async recordPage(page: ActionPage) {
      for (const event of page.events) {
        const p = [...profiles.values()].find(p => p.uuid && normalize(p.uuid) === normalize(event.profileId));
        if (!p || events.some(e => e.id === event.id)) continue;
        events.push({ ...event, profileId: normalize(event.profileId), seq: nextSeq++ });
        if (isDeletionEvent(event.action) && !p.deletion) {
          p.deletion = initialDeletion(event.id); p.revision++;
          const c = clients.get(p.clientId);
          if (c && setupUsesProfile(c.setup, p)) c.revision++;
        }
      }
      stream.cursor = structuredClone(page.watermark);
    },
    async setCoverage(since) { stream.coverageSince = Math.max(stream.coverageSince, since); },
    async leader() {
      if (held) return; held = true; let active = true;
      return { async check() { if (!active) throw new OctoError('octo_leadership_lost'); },
        async release() { if (active) { held = false; active = false; } } };
    }
  };
}
export function mockClient(id: number): WebClient {
  const firstName = id === 901 ? 'Alex' : id === 902 ? 'Bob' : 'Other';
  return { id, firstName, lastName: 'OctoTest', clientName: firstName, fio: `${firstName} OctoTest`,
    calendarEmail: `${firstName.toLowerCase()}.octo@example.com`, primaryStack: 'REACT', commonChatId: `octo-test-${id}`,
    market: 'Ru' } as WebClient;
}
export const testConfig: OctoConfig = { allowedClientIds: new Set([901,902]), homeFolder: 'home', guestFolder: 'guest',
  guest: { email: 'guest@example.com', password: 'guest-test-only' }, leaseMs: 45_000 };
export function createMockCloud(store: OctoStore, now = Date.now) {
  const profiles = new Map<string, Profile>(), passwords = new Map<string, string>(), calls: string[] = [];
  let afterWrite: ((action: string) => void) | undefined;
  const event = async (uuid: string, action: string, title?: string) => {
    const id = randomUUID(), time = Math.floor(now()/1000);
    await store.recordPage({ events: [{ id, profileId: uuid, action, time, ...(title ? { title } : {}) }], watermark: { uuid: id, time } });
  };
  const get = (uuid: string) => { const p = profiles.get(uuid); if (!p) throw new OctoError('octo_not_found'); return p; };
  const api: CloudApi = {
    async listFolders() { return [{ uuid: 'home', name: 'private' }, { uuid: 'guest', name: 'g-folder' }]; },
    async validateGuest() {}, async listProfiles() { return [...profiles.values()].map(p => ({ uuid:p.uuid, description:p.description })); },
    async listProxies() { return []; }, async updateProxy() { throw new Error('unexpected_proxy'); },
    async deleteProxy() { throw new Error('unexpected_proxy'); },
    async profileExists(uuid) { return profiles.has(uuid); },
    async proxyConnections() { return []; }, async createProxy() { throw new Error('unexpected_proxy'); },
    async attachProxy() { throw new Error('unexpected_proxy'); },
    async createProfile(input) {
      const uuid = randomUUID().replaceAll('-', ''); calls.push('create'); passwords.set(uuid,input.password);
      profiles.set(uuid, { ...input, uuid, has_user_password: true, status: 0, proxy: input.proxy ? { uuid: input.proxy } : null });
      afterWrite?.('create'); return uuid;
    },
    async getProfile(uuid) { return structuredClone(get(uuid)); },
    async updateProfile(uuid,input) {
      calls.push(`update:${uuid}`); Object.assign(get(uuid), structuredClone(input));
      await event(uuid,'profiles.updated',input.title); afterWrite?.('update');
    },
    async setPassword(uuid,password) { calls.push(`protect:${uuid}`); passwords.set(uuid,password); get(uuid).has_user_password=true; afterWrite?.('protect'); },
    async clearPassword(uuid,password) {
      calls.push(`clear:${uuid}`);
      if (password !== passwords.get(uuid) || get(uuid).status !== 0) throw new OctoError('octo_request_failed',502,{upstreamCode:'profiles.password_error'});
      get(uuid).has_user_password=false; afterWrite?.('clear');
    }
  };
  return { api, calls, profiles, passwords, afterWrite(fn?: (action: string) => void) { afterWrite = fn; },
    async start(uuid: string) { get(uuid).status=1; await event(uuid,'profiles.started'); },
    async stop(uuid: string) { get(uuid).status=0; await event(uuid,'profiles.stopped'); },
    async force(uuid: string) { get(uuid).status=0; await event(uuid,'profiles.force_stopped'); }
  };
}
