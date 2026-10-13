import { createOctoApi } from '../octo-access-test/octo-api.mts';
import { OctoError } from './contracts.mts';
import type { CloudApi } from './contracts.mts';
export const normalizeUuid = (id: string) => id.replaceAll('-', '').toLowerCase();
export function createCloudApi(token: string, fetchImpl: typeof fetch = fetch): CloudApi {
  const base = createOctoApi(token, fetchImpl, { cloudOnly: true });
  const list = async (path: string) => {
    const rows = await base.cloudRequest(path);
    if (!Array.isArray(rows)) throw new OctoError('invalid_octo_response', 502);
    return rows as Record<string, any>[];
  };
  return {
    listFolders: base.listFolders, createProfile: base.createProfile,
    async getProfile(uuid) {
      const profile = await base.getProfile(uuid), folder = profile.folder;
      if (folder === null || (typeof folder === 'object' && folder.uuid)) return profile;
      // The live Profiles API returns a folder name; PATCH takes its UUID.
      // Resolve from the current folder list, never compare a display name to an ID.
      const value = typeof folder === 'string' ? folder : folder.name;
      const matches = (await base.listFolders()).filter(f => f.name === value || normalizeUuid(f.uuid) === normalizeUuid(value ?? ''));
      if (matches.length !== 1) throw new OctoError('invalid_octo_response', 502, { field: 'folder' });
      return { ...profile, folder: { uuid: matches[0].uuid, name: matches[0].name } };
    },
    updateProfile: base.updateProfile, setPassword: base.setPassword, clearPassword: base.clearPassword,
    async listProfiles() {
      const result: Array<{ uuid: string; description: string }> = [];
      for (let page = 0; page < 10_000; page++) {
        const rows = await list(`/profiles?page_len=100&page=${page}&fields=description`);
        for (const row of rows) {
          if (typeof row.uuid !== 'string') throw new OctoError('invalid_octo_response', 502);
          result.push({ uuid: row.uuid, description: String(row.description ?? '') });
        }
        if (rows.length < 100) return result;
      }
      throw new OctoError('octo_pagination_limit', 502);
    },
    async listProxies() {
      return (await list('/proxies')).map(p => {
        if (typeof p.uuid !== 'string' || typeof p.title !== 'string' || !Number.isInteger(p.profiles_count))
          throw new OctoError('invalid_octo_response', 502);
        return { uuid: p.uuid, title: p.title, profiles_count: p.profiles_count };
      });
    },
    async updateProxy(uuid, title) { await base.cloudRequest(`/proxies/${encodeURIComponent(uuid)}`, 'PATCH', { title }); },
    async validateGuest(email, guestFolder) {
      const guest = (await list('/teams/subaccounts')).find(p => String(p.email).toLowerCase() === email.toLowerCase());
      const p = guest?.permissions;
      // Unknown/extra true rights are rejected, including future upstream permissions.
      const hasTrue = (value: unknown): boolean => value === true || (!!value && typeof value === 'object'
        && Object.values(value).some(hasTrue));
      if (!guest || guest.master !== false || !p || hasTrue(p)
        || !Array.isArray(p.visible_folders) || p.visible_folders.length !== 1
        || normalizeUuid(String(p.visible_folders[0])) !== normalizeUuid(guestFolder)
        || !Array.isArray(p.visible_tags) || p.visible_tags.length)
        throw new OctoError('octo_guest_permissions_changed', 409);
    }
  };
}
