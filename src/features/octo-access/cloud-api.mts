import { createOctoApi } from '../octo-access-test/octo-api.mts';
import { OctoError } from './contracts.mts';
import type { CloudApi, SavedProxy } from './contracts.mts';
import { parseProxyInput } from './proxy-input.mts';
import { upstreamNotFound } from './deletion-state.mts';
export const normalizeUuid = (id: string) => id.replaceAll('-', '').toLowerCase();
export function createCloudApi(token: string, fetchImpl: typeof fetch = fetch): CloudApi {
  const base = createOctoApi(token, fetchImpl, { cloudOnly: true });
  const list = async (path: string) => {
    const rows = await base.cloudRequest(path);
    if (!Array.isArray(rows)) throw new OctoError('invalid_octo_response', 502);
    return rows as Record<string, any>[];
  };
  const proxy = (row: Record<string, any>): SavedProxy => {
    if (typeof row.uuid !== 'string' || typeof row.title !== 'string' || !Number.isInteger(row.profiles_count))
      throw new OctoError('invalid_octo_response', 502);
    let input;
    try { input = parseProxyInput({ ...row, type: row.type === 'socks' ? 'socks4' : row.type, changeIpUrl: row.change_ip_url }); }
    catch { throw new OctoError('invalid_octo_response', 502); }
    return { ...input, uuid: row.uuid, title: row.title, profiles_count: row.profiles_count,
      ...(typeof row.external_id === 'string' ? { externalId: row.external_id } : {}) };
  };
  return {
    async readProfileProxy(uuid) {
      const row = await base.cloudRequest(`/profiles/${encodeURIComponent(uuid)}`);
      if (!row?.proxy) throw new OctoError('octo_proxy_required', 409);
      const value = row.proxy;
      if (typeof value.uuid === 'string' && value.uuid) {
        const found = (await list('/proxies')).filter(p => normalizeUuid(p.uuid) === normalizeUuid(value.uuid));
        if (found.length !== 1) throw new OctoError('octo_proxy_unavailable', 409);
        return { saved: proxy(found[0]) };
      }
      return { inline: parseProxyInput({ ...value, type: value.type === 'socks' ? 'socks4' : value.type, changeIpUrl: value.change_ip_url }) };
    },
    listFolders: base.listFolders, createProfile: base.createProfile,
    async profileExists(uuid) {
      try { await base.getProfile(uuid); return true; }
      catch (error) { if (upstreamNotFound(error)) return false; throw error; }
    },
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
    async deleteProxy(uuid) {
      try { await base.cloudRequest(`/proxies/${encodeURIComponent(uuid)}`, 'DELETE'); }
      catch (error) { if (!upstreamNotFound(error)) throw error; }
    },
    async proxyConnections(externalId) { return (await list('/proxies')).filter(p => p.external_id === externalId).map(proxy); },
    async createProxy(input) {
      const { type, host, port, login, password, title, externalId, changeIpUrl } = input;
      return proxy(await base.cloudRequest('/proxies', 'POST', { type: type === 'socks4' ? 'socks' : type,
        host, port, login, password, title, external_id: externalId, ...(changeIpUrl ? { change_ip_url: changeIpUrl } : {}) }));
    },
    async attachProxy(profileUuid, proxyUuid) {
      await base.cloudRequest(`/profiles/${encodeURIComponent(profileUuid)}`, 'PATCH', { proxy: proxyUuid });
    },
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
