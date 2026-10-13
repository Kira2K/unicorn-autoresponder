import type { Profile, Folder } from '../octo-access-test/contract.mts';
import type { ActionPage, ActionEvent, Cursor } from '../octo-access-test/action-log.mts';
export { TestError as OctoError } from '../octo-access-test/contract.mts';
export type Locale = 'ru' | 'en';
export interface Metadata { title: string; description: string; tags: string[]; start_pages: string[] }
export interface ProxyRef { uuid: string; title: string; profiles_count: number }
export interface Grant {
  id: string; phase: 'preparing' | 'granted' | 'awaiting_close' | 'complete' | 'blocked';
  alias: string; createdAt: number; eventsAfter: number; grantedAt?: number; expiresAt?: number;
  hiddenAt?: number; completedAt?: number; error?: string;
  pending?: 'protect' | 'mask_proxy' | 'publish' | 'hide' | 'restore_proxy' | 'clear';
  attemptedAt?: number; original: Metadata; originalProxyTitle?: string;
}
export interface ManagedProfile {
  id: number; clientId: number; locale: Locale; revision: number; operationId: string;
  password: string; uuid?: string; original: Metadata; createdAt: number; ownProxy: boolean;
  phase: 'queued' | 'creating' | 'ready' | 'blocked'; error?: string;
  proxy?: { uuid: string; title: string }; proxyName?: string;
  pending?: 'create' | 'proxy_name'; grant?: Grant;
}
export type NewProfile = Omit<ManagedProfile, 'id' | 'revision'>;
export interface StoredEvent extends ActionEvent { seq: number; title?: string }
export interface StreamState { cursor?: Cursor; coverageSince: number }
// Mutations are short SQL transactions. No network call occurs inside them.
export interface OctoStore {
  checkSchema(): Promise<void>;
  list(clientId?: number): Promise<ManagedProfile[]>;
  get(id: number): Promise<ManagedProfile | undefined>;
  reserve(profiles: NewProfile[]): Promise<ManagedProfile[]>;
  save(profile: ManagedProfile): Promise<ManagedProfile>;
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
  createProfile(input: Metadata & { folder: string; password: string; proxy?: string }): Promise<string>;
  updateProfile(uuid: string, patch: Metadata & { folder: string }): Promise<void>;
  setPassword(uuid: string, password: string): Promise<void>;
  clearPassword(uuid: string, password: string): Promise<void>;
  listProfiles(): Promise<Array<{ uuid: string; description: string }>>;
  listProxies(): Promise<ProxyRef[]>;
  updateProxy(uuid: string, title: string): Promise<void>;
  validateGuest(email: string, guestFolder: string): Promise<void>;
}
export interface OctoConfig {
  enabled?: boolean;
  allowedClientIds: ReadonlySet<number>; homeFolder: string; guestFolder: string;
  guest: { email: string; password: string }; leaseMs: number;
}
