export const NAMES = ['Alex', 'Bob'] as const;
export type ProfileName = typeof NAMES[number];
export const PASSWORDS: Record<ProfileName, string> = { Alex: 'Alex', Bob: 'Bob1' };
export const GUARANTEE_MS = 120_000;
export const FOLDER_NAMES = { home: 'octo-test-main', guest: 'g-folder' } as const;
export const wiki = (name: ProfileName) => `https://en.wikipedia.org/w/index.php?search=${name.toLowerCase()}`;
export const marker = (runId: string, name: ProfileName) => `octo-access-test:${runId}:${name}`;

export interface Folder { uuid: string; name: string }
export interface Profile {
  uuid: string;
  title: string;
  description: string;
  folder: string | { uuid?: string; name?: string } | null;
  has_user_password: boolean;
  start_pages: string[];
  tags?: string[];
  version?: string | number;
  status?: number;
  proxy?: { uuid: string; title?: string } | null;
}
export interface Octo {
  listFolders(): Promise<Folder[]>;
  createFolder(name: string): Promise<Folder>;
  createProfile(input: { title: string; description: string; folder: string; start_pages: string[]; password?: string; proxy?: string; tags?: string[] }): Promise<string>;
  getProfile(uuid: string): Promise<Profile>;
  updateProfile(uuid: string, input: { title: string; folder: string; description?: string; tags?: string[]; start_pages?: string[] }): Promise<void>;
  setPassword(uuid: string, password: string): Promise<void>;
  clearPassword(uuid: string, password: string): Promise<void>;
  activeProfiles(): Promise<string[]>;
  startProfile(uuid: string, password?: string): Promise<{ uuid: string; state: string; debug_port?: number }>;
}
export interface State {
  schema: 1;
  runId: string;
  phase: 'new' | 'working' | 'ready' | 'blocked';
  folders: Partial<Record<'home' | 'guest', Folder>>;
  profiles: Partial<Record<ProfileName, string>>;
  active: ProfileName | null;
  grantedAt: number | null;
  step?: string;
  error?: string;
  errorDetails?: Record<string, unknown>;
}
export interface Store { load(): Promise<State | null>; save(state: State): Promise<void> }
export class TestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: string, status = 409, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function profileName(value: unknown): ProfileName {
  if (value !== 'Alex' && value !== 'Bob') throw new TestError('profile_must_be_Alex_or_Bob', 400);
  return value;
}
