import { OctoError } from './contracts.mts';
import type { CloudApi, ManagedProfile, OctoConfig, OctoStore, ProxyRef } from './contracts.mts';
import { normalizeUuid } from './cloud-api.mts';
export const safeCode = (error: unknown) => {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^(octo_|invalid_octo_|postgres_|commit_|duplicate_)[a-z_]{1,70}$/.test(code)
    ? code : 'octo_operation_failed';
};
export function selectOctoProxy(proxies: ProxyRef[], profile: ManagedProfile, reserved: ReadonlySet<string>): ProxyRef | undefined {
  const words = (profile.proxyName ?? '').split('|').map(s => s.trim().toLowerCase());
  const candidates = proxies.filter(p => p.profiles_count === 0 && !reserved.has(p.uuid));
  const named = candidates.filter(p => words[0] && words[2] && p.title.toLowerCase().includes(words[0]) && p.title.toLowerCase().includes(words[2]));
  const ready = candidates.filter(p => /^Ready\s+\d+/i.test(p.title));
  return named.sort((a,b) => a.uuid.localeCompare(b.uuid))[0] ?? ready.sort((a,b) =>
    Number(a.title.match(/^Ready\s+(\d+)/i)?.[1]) - Number(b.title.match(/^Ready\s+(\d+)/i)?.[1]) || a.uuid.localeCompare(b.uuid))[0];
}
export const inFolder = (p: { folder: string | { uuid?: string; name?: string } | null }, uuid: string) =>
  normalizeUuid(typeof p.folder === 'string' ? p.folder : p.folder?.uuid ?? '') === normalizeUuid(uuid);
export async function provisionProfile(initial: ManagedProfile, deps: { store: OctoStore; api: CloudApi; config: OctoConfig; check(): Promise<void> }) {
  const { store, api, config, check } = deps;
  let p = initial;
  const save = async () => { await check(); p = await store.save(p); };
  try {
    if (p.phase === 'ready' || (p.phase === 'blocked' && !p.pending)) return;
    if (p.pending === 'create') {
      // A timed-out create can have succeeded. Adopt only our exact persisted operation marker.
      const found = (await api.listProfiles()).filter(q => q.description === p.original.description);
      if (found.length !== 1) throw new OctoError('octo_create_outcome_unknown');
      p.uuid = found[0].uuid; delete p.pending; p.phase = 'creating'; await save();
    }
    if (!p.uuid) {
      if (p.locale === 'en' && !p.ownProxy && !p.proxy) {
        const reserved = new Set((await store.list()).flatMap(p => p.proxy ? [p.proxy.uuid] : []));
        const selected = selectOctoProxy(await api.listProxies(), p, reserved);
        if (!selected) throw new OctoError('octo_proxy_unavailable');
        p.proxy = { uuid: selected.uuid, title: selected.title }; await save();
      }
      p.phase = 'creating'; p.pending = 'create'; await save(); await check();
      p.uuid = await api.createProfile({ ...p.original, folder: config.homeFolder, password: p.password,
        ...(p.proxy ? { proxy: p.proxy.uuid } : {}) });
      delete p.pending; await save();
    }
    const live = await api.getProfile(p.uuid);
    if (!inFolder(live, config.homeFolder) || live.status !== 0 || !live.has_user_password
      || live.title !== p.original.title || live.description !== p.original.description
      || (p.proxy && normalizeUuid(live.proxy?.uuid ?? '') !== normalizeUuid(p.proxy.uuid)))
      throw new OctoError('octo_created_profile_changed');
    if (p.proxy) {
      const title = p.proxyName!.replace('{profileId}', p.uuid).slice(0, 255);
      const current = (await api.listProxies()).find(q => q.uuid === p.proxy!.uuid);
      if (!current || current.profiles_count !== 1) throw new OctoError('octo_proxy_changed');
      if (current.title !== title) {
        if (p.pending === 'proxy_name') throw new OctoError('octo_proxy_write_unknown');
        p.pending = 'proxy_name'; await save(); await check(); await api.updateProxy(p.proxy.uuid, title);
        const verified = (await api.listProxies()).find(q => q.uuid === p.proxy!.uuid);
        if (verified?.title !== title) throw new OctoError('octo_proxy_write_unknown');
      }
      p.proxy.title = title;
    }
    p.phase = 'ready'; delete p.pending; delete p.error; await save();
  } catch (error) {
    // A failed persistence/leadership check must never be followed by another write.
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(String((error as any)?.code))) throw error;
    p.phase = 'blocked'; p.error = safeCode(error); await save();
  }
}
