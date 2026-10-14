import { OctoError } from './contracts.mts';
import type { CloudApi, ManagedProfile, OctoConfig, OctoStore, SavedProxy } from './contracts.mts';
import { inFolder, safeCode } from './provision.mts';
export const proxyBusy = (p: ManagedProfile) => !!p.proxyChange && p.proxyChange.phase !== 'complete';
export const canEditProxy = (p: ManagedProfile) => !p.deletion && p.phase === 'ready' && !p.pending && !proxyBusy(p) && (!p.grant || p.grant.phase === 'complete');
export async function advanceProxy(initial: ManagedProfile, deps: {
  store: OctoStore; api: CloudApi; config: OctoConfig; check(): Promise<void>;
}) {
  const { store, api, config, check } = deps;
  let p = initial, operation = p.proxyChange;
  if (!p.uuid || !operation || operation.phase === 'complete' || operation.phase === 'blocked' && !operation.pending) return;
  const save = async () => { await check(); p.proxyChange = operation; p = await store.save(p); operation = p.proxyChange!; };
  try {
    if (p.grant && p.grant.phase !== 'complete') throw new OctoError('octo_cleanup_pending', 409);
    const live = await api.getProfile(p.uuid);
    if (!inFolder(live, config.homeFolder) || live.status !== 0 || live.title !== p.original.title || live.description !== p.original.description)
      throw new OctoError('octo_profile_not_idle', 409);
    const marker = `unicorn-octo-proxy:${operation.id}`;
    let candidates = await api.proxyConnections(marker);
    const matches = (q: SavedProxy) => operation!.input && q.title === operation!.title &&
      ['type', 'host', 'port', 'login', 'password', 'changeIpUrl'].every(key => (q as any)[key] === (operation!.input as any)[key]);
    if (candidates.length > 1 || candidates.some(q => !matches(q))) throw new OctoError('octo_proxy_write_unknown');
    if (!candidates.length) {
      if (operation.pending || operation.uuid || !operation.input) throw new OctoError('octo_proxy_write_unknown');
      operation.phase = 'creating'; operation.pending = 'create'; await save(); await check();
      await api.createProxy({ ...operation.input!, title: operation.title, externalId: marker });
      candidates = await api.proxyConnections(marker);
      if (candidates.length !== 1 || !matches(candidates[0])) throw new OctoError('octo_proxy_write_unknown');
    }
    const proxy = candidates[0];
    const attached = live.proxy?.uuid === proxy.uuid;
    if (proxy.profiles_count !== (attached ? 1 : 0)) throw new OctoError('octo_proxy_changed');
    operation.uuid = proxy.uuid;
    if (!attached) {
      if (operation.pending === 'attach') throw new OctoError('octo_proxy_write_unknown');
      // Persist the reservation before attaching; the unique index rejects shared assignments.
      p.proxy = { uuid: proxy.uuid, title: proxy.title, type: proxy.type, host: proxy.host, port: proxy.port };
      operation.phase = 'attaching'; operation.pending = 'attach'; await save(); await check();
      await api.attachProxy(p.uuid!, proxy.uuid);
      const verified = await api.getProfile(p.uuid!);
      if (verified.proxy?.uuid !== proxy.uuid || !inFolder(verified, config.homeFolder) || verified.status !== 0)
        throw new OctoError('octo_proxy_write_unknown');
    }
    p.proxy = { uuid: proxy.uuid, title: proxy.title, type: proxy.type, host: proxy.host, port: proxy.port };
    operation.phase = 'complete'; delete operation.pending; delete operation.input; delete operation.error; await save();
  } catch (error) {
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(String((error as any)?.code))) throw error;
    operation!.phase = 'blocked'; operation!.error = safeCode(error); await save();
  }
}
