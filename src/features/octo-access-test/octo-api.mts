import { TestError } from './contract.mts';
import type { Folder, Octo, Profile } from './contract.mts';

const CLOUD = 'https://app.octobrowser.net/api/v2/automation';
const LOCAL = 'http://127.0.0.1:58888';
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TestError('invalid_octo_response', 502);
  return value;
};

export function createOctoApi(token: string, fetchImpl: typeof fetch = fetch, options: { passwordClear?: 'local' | 'cloud'; debugPort?: boolean; cloudOnly?: boolean } = {}): Octo & {
  cloudRequest(path: string, method?: string, body?: unknown): Promise<any>
} {
  if (!token.trim()) throw new TestError('OCTO_API_TOKEN_missing', 500);
  async function request(local: boolean, path: string, method = 'GET', body?: unknown): Promise<any> {
    if (local && options.cloudOnly) throw new TestError('local_api_disabled', 409);
    let response: Response;
    try {
      response = await fetchImpl(`${local ? LOCAL : CLOUD}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(local && method !== 'GET' ? 55_000 : 20_000),
        headers: { ...(local ? {} : { 'X-Octo-Api-Token': token }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch { throw new TestError('octo_request_outcome_unknown', 502, { method, path }); }
    let result: any;
    try { result = await response.json(); } catch { throw new TestError('invalid_octo_response', 502); }
    if (!response.ok || (object(result) && (result.success === false || result.error || result.error_code))) {
      // Upstream messages may include input values. Return only bounded machine codes.
      const upstreamCode = object(result) && typeof result.code === 'string' && /^[a-z_.-]{1,80}$/i.test(result.code) ? result.code : undefined;
      throw new TestError('octo_request_failed', 502, { httpStatus: response.status, upstreamCode, method, path });
    }
    if (local) return result;
    if (!object(result) || result.success !== true) throw new TestError('invalid_octo_response', 502);
    return result.data;
  }
  function folder(value: unknown): Folder {
    if (!object(value)) throw new TestError('invalid_octo_response', 502);
    return { uuid: id(value.uuid), name: id(value.name) };
  }
  return {
    cloudRequest: (path, method, body) => request(false, path, method, body),
    async listFolders() {
      const data = await request(false, '/folders');
      if (!Array.isArray(data)) throw new TestError('invalid_octo_response', 502);
      return data.map(folder);
    },
    async createFolder(name) {
      const data = await request(false, '/folders', 'POST', { folders: [{ name, assignable_wo_permission: false }] });
      if (!Array.isArray(data) || data.length !== 1) throw new TestError('invalid_octo_response', 502);
      return folder(data[0]);
    },
    async createProfile(input) {
      const data = await request(false, '/profiles', 'POST', {
        ...input, fingerprint: { os: 'win' },
        storage_options: { cookies: true, passwords: true, localstorage: true, history: true, bookmarks: true }
      });
      return id(data?.uuid);
    },
    async getProfile(uuid) {
      const data = await request(false, `/profiles/${encodeURIComponent(uuid)}`);
      if (!object(data) || typeof data.has_user_password !== 'boolean' || !Array.isArray(data.start_pages)
        || !data.start_pages.every((v: unknown) => typeof v === 'string')
        || !(data.folder === null || typeof data.folder === 'string' || object(data.folder))) {
        throw new TestError('invalid_octo_response', 502);
      }
      return {
        uuid: id(data.uuid), title: id(data.title), description: String(data.description ?? ''),
        folder: data.folder, has_user_password: data.has_user_password, start_pages: data.start_pages,
        tags: Array.isArray(data.tags) ? data.tags : [],
        version: data.version, status: data.status,
        ...(data.proxy === undefined ? {} : { proxy: data.proxy ? { uuid: String(data.proxy.uuid ?? ''), title: String(data.proxy.title ?? '') } : null })
      } as Profile;
    },
    async updateProfile(uuid, input) { await request(false, `/profiles/${encodeURIComponent(uuid)}`, 'PATCH', input); },
    async setPassword(uuid, password) { await request(false, '/profiles/set_password', 'POST', { profiles: [uuid], password }); },
    // The cloud endpoint rejects the running session in the live main-account test.
    // The local client owns that session and can clear its password without stopping it.
    async clearPassword(uuid, password) {
      if (options.cloudOnly || options.passwordClear === 'cloud') await request(false, `/profiles/${encodeURIComponent(uuid)}/clear_password`, 'POST', { password });
      else await request(true, '/api/profiles/password', 'DELETE', { uuid, password });
    },
    async activeProfiles() {
      const data = await request(true, '/api/profiles/active');
      if (!Array.isArray(data)) throw new TestError('invalid_octo_response', 502);
      return data.map(p => id(p?.uuid));
    },
    async startProfile(uuid, password) {
      const data = await request(true, '/api/profiles/start', 'POST', {
        uuid, headless: false, debug_port: options.debugPort ?? false, only_local: true, timeout: 50,
        ...(password === undefined ? {} : { password })
      });
      if (data?.uuid !== uuid || data?.state !== 'STARTED') throw new TestError('invalid_octo_response', 502);
      return { uuid, state: data.state, ...(options.debugPort && Number(data.debug_port) ? { debug_port: Number(data.debug_port) } : {}) };
    }
  };
}
