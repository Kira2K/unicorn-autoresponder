import type { Profile, Folder } from '../octo-access-test/contract.mts';
import type { ActionPage, ActionEvent, Cursor } from '../octo-access-test/action-log.mts';
import type { ClientState } from './onboarding-contracts.mts';
export { TestError as OctoError } from '../octo-access-test/contract.mts';
export type Locale = 'ru' | 'en';
export interface Metadata { title: string; description: string; tags: string[]; start_pages: string[] }
export interface ProxyRef { uuid: string; title: string; profiles_count: number }
export interface ProxyInput {
  type: 'http' | 'https' | 'socks4' | 'socks5'; host: string; port: number;
  login: string; password: string; changeIpUrl?: string;
}
export interface SavedProxy extends ProxyRef, ProxyInput { externalId?: string }
export interface ProxyChange {
  id: string; phase: 'queued' | 'creating' | 'attaching' | 'complete' | 'blocked';
  input?: ProxyInput; uuid?: string; title: string; error?: string; pending?: 'create' | 'attach';
}
export interface Grant {
  id: string; phase: 'preparing' | 'granted' | 'awaiting_close' | 'complete' | 'blocked';
  alias: string; createdAt: number; eventsAfter: number; grantedAt?: number; expiresAt?: number;
  hiddenAt?: number; completedAt?: number; error?: string;
  pending?: 'protect' | 'mask_proxy' | 'publish' | 'hide' | 'restore_proxy' | 'clear';
  attemptedAt?: number; original: Metadata; originalProxyTitle?: string;
  clearMethod?: 'bridge';
  bridgeClear?: {
    bridgeId: string; ownerEmail: string;
    claim?: { deviceId: string; authorizedAt?: number };
    result?: { state: 'succeeded' | 'uncertain' | 'rejected'; code?: string; at: number };
  };
}
export interface ProfileDeletion {
  eventId: string;
  phase: 'verify' | 'proxies' | 'purge' | 'blocked';
  attempts: number;
  nextAttemptAt: number;
  error?: string;
}
export interface ManagedProfile {
  id: number; clientId: number; locale: Locale; revision: number; operationId: string;
  password: string; uuid?: string; original: Metadata; createdAt: number; ownProxy: boolean;
  phase: 'queued' | 'creating' | 'ready' | 'blocked'; error?: string;
  proxy?: { uuid: string; title: string; type?: string; host?: string; port?: number }; proxyName?: string;
  proxyChange?: ProxyChange;
  pending?: 'create' | 'proxy_name'; grant?: Grant;
  deletion?: ProfileDeletion;
}
export type NewProfile = Omit<ManagedProfile, 'id' | 'revision'>;
export interface StoredEvent extends ActionEvent { seq: number; title?: string }
export interface StreamState { cursor?: Cursor; coverageSince: number }
// Mutations are short SQL transactions. No network call occurs inside them.
export interface OctoStore {
  checkSchema(): Promise<void>;
  clientState(clientId: number): Promise<ClientState | undefined>;
  clientStates(): Promise<ClientState[]>;
  claimClientPassword(clientId: number, candidate: string): Promise<ClientState>;
  saveClientState(input: ClientState): Promise<ClientState>;
  list(clientId?: number): Promise<ManagedProfile[]>;
  get(id: number): Promise<ManagedProfile | undefined>;
  reserve(profiles: NewProfile[]): Promise<ManagedProfile[]>;
  save(profile: ManagedProfile): Promise<ManagedProfile>;
  // Deletes the binding, private state and events atomically; requires confirmed cleanup.
  remove(profile: ManagedProfile): Promise<void>;
  events(uuid: string, after?: number): Promise<StoredEvent[]>;
  stream(): Promise<StreamState>;
  recordPage(page: ActionPage): Promise<void>;
  setCoverage(since: number): Promise<void>;
  // Held on a dedicated connection; losing it invalidates leadership.
  leader(): Promise<{ check(): Promise<void>; release(): Promise<void> } | undefined>;
}
export interface CloudApi {
  listFolders(): Promise<Folder[]>;
  getProfile(uuid: string): Promise<Profile>;
  profileExists(uuid: string): Promise<boolean>;
  createProfile(input: Metadata & { folder: string; password: string; proxy?: string }): Promise<string>;
  updateProfile(uuid: string, patch: Metadata & { folder: string }): Promise<void>;
  setPassword(uuid: string, password: string): Promise<void>;
  clearPassword(uuid: string, password: string): Promise<void>;
  listProfiles(): Promise<Array<{ uuid: string; description: string }>>;
  listProxies(): Promise<ProxyRef[]>;
  updateProxy(uuid: string, title: string): Promise<void>;
  deleteProxy(uuid: string): Promise<void>;
  proxyConnections(externalId: string): Promise<SavedProxy[]>;
  createProxy(input: ProxyInput & { title: string; externalId: string }): Promise<SavedProxy>;
  attachProxy(profileUuid: string, proxyUuid: string): Promise<void>;
  validateGuest(email: string, guestFolder: string): Promise<void>;
}
export interface OctoConfig {
  enabled?: boolean;
  allowAll?: boolean;
  allowedClientIds: ReadonlySet<number>; homeFolder: string; guestFolder: string;
  guest: { email: string; password: string }; leaseMs: number;
}
