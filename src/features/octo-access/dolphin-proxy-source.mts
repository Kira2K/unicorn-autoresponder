import { createRequire } from 'node:module';
import { OctoError } from './contracts.mts';
import type { ProxyInput } from './contracts.mts';
import { parseProxyInput } from './proxy-input.mts';

const require = createRequire(import.meta.url);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const defaultRead = (id: number): Promise<any> => require('../../integrations/dolphin/profile-proxy.ts').getDolphinProfileWithProxy(id);

function connection(profile: unknown): ProxyInput | undefined {
  if (!record(profile) || (!('id' in profile) && !('proxy' in profile) && !('proxyId' in profile)))
    throw new OctoError('octo_dolphin_profile_invalid', 502);
  const proxy = profile.proxy;
  if (proxy == null) {
    if (![undefined, null, '', 0, '0'].includes(profile.proxyId))
      throw new OctoError('octo_dolphin_proxy_invalid', 502);
    return undefined;
  }
  if (!record(proxy)) throw new OctoError('octo_dolphin_proxy_invalid', 502);
  try {
    return parseProxyInput({ type: proxy.protocol ?? proxy.type, host: proxy.host ?? proxy.server ?? proxy.ip,
      port: proxy.port, login: proxy.username ?? proxy.login, password: proxy.password,
      changeIpUrl: proxy.changeIpUrl ?? proxy.change_ip_url });
  } catch { throw new OctoError('octo_dolphin_proxy_invalid', 502); }
}

/** Lists only database-owned profiles; proxy() is called after the caller verifies ownership. */
export function createDolphinProxySource({ profiles, readProfile = defaultRead, now = Date.now }: {
  profiles(clientId: number): Promise<Array<{ id: number; locale: string }>>;
  readProfile?: (id: number) => Promise<any>;
  now?: () => number;
}) {
  const cache = new Map<number, { expires: number; value: Promise<boolean> }>();
  const read = async (id: number) => {
    let profile: unknown;
    try { profile = await readProfile(id); }
    catch { throw new OctoError('octo_dolphin_read_failed', 502); }
    if (record(profile) && profile.id !== undefined && Number(profile.id) !== id)
      throw new OctoError('octo_dolphin_profile_invalid', 502);
    return connection(profile);
  };
  const hasProxy = (id: number): Promise<boolean> => {
    const existing = cache.get(id);
    if (existing && existing.expires > now()) return existing.value;
    const entry = { expires: Infinity, value: Promise.resolve(false) };
    entry.value = read(id).then(proxy => { entry.expires = now() + 30_000; return !!proxy; }, error => {
      if (cache.get(id) === entry) cache.delete(id);
      throw error;
    });
    cache.set(id, entry);
    return entry.value;
  };
  return {
    async list(clientId: number): Promise<Array<{ id: number; locale: string; hasProxy: boolean }>> {
      if (!validId(clientId)) throw new OctoError('octo_dolphin_profile_invalid', 400);
      let owned: Array<{ id: number; locale: string }>;
      try { owned = await profiles(clientId); }
      catch { throw new OctoError('octo_dolphin_profiles_failed', 502); }
      if (!Array.isArray(owned) || owned.some(item => !record(item) || !validId(item.id) || typeof item.locale !== 'string' || !item.locale)
        || new Set(owned.map(item => item.id)).size !== owned.length)
        throw new OctoError('octo_dolphin_profiles_invalid', 502);
      return Promise.all(owned.map(async item => ({ id: item.id, locale: item.locale, hasProxy: await hasProxy(item.id) })));
    },
    async proxy(profileId: number): Promise<ProxyInput | undefined> {
      if (!validId(profileId)) throw new OctoError('octo_dolphin_profile_invalid', 400);
      return read(profileId);
    }
  };
}
