import { OctoError } from './contracts.mts';
import type { CloudApi, ManagedProfile, OctoStore } from './contracts.mts';
import { normalizeUuid } from './cloud-api.mts';
import { transientOctoError } from './deletion-state.mts';

const RETRY_MS = 30_000;
/** One event-driven cleanup; attempts and phase survive process restarts. No polling discovery. */
export async function advanceDeletion(initial: ManagedProfile, deps: {
  store: OctoStore; api: CloudApi; check(): Promise<void>; now?: () => number;
}) {
  const { store, api, check, now = Date.now } = deps;
  let p = initial;
  const save = async () => { await check(); p = await store.save(p); };
  if (!p.uuid || !p.deletion || p.deletion.phase === 'blocked' || p.deletion.nextAttemptAt > now()) return;
  try {
    for (const phase of ['verify', 'proxies'] as const) {
      if (p.deletion!.phase !== phase) continue;
      // A crash after dispatch also consumes an attempt. Never silently reset the budget.
      if (p.deletion!.attempts >= 2) throw new OctoError('octo_deletion_outcome_unknown');
      p.deletion!.attempts++; p.deletion!.nextAttemptAt = now() + RETRY_MS;
      delete p.deletion!.error; await save(); await check();
      if (phase === 'verify') {
        if (await api.profileExists(p.uuid)) { delete p.deletion; await save(); return; }
        p.deletion!.phase = 'proxies'; p.deletion!.attempts = 0; p.deletion!.nextAttemptAt = 0; await save();
      } else {
        const targets = new Set([p.proxy?.uuid, p.proxyChange?.uuid].filter((v): v is string => !!v).map(normalizeUuid));
        if (p.proxyChange?.pending === 'create') {
          const marker = `unicorn-octo-proxy:${p.proxyChange.id}`;
          const found = await api.proxyConnections(marker);
          // A timed-out creation may still finish remotely. An empty read cannot prove
          // it never happened; retain the operation marker until its outcome is known.
          if (!found.length) throw new OctoError('octo_request_outcome_unknown');
          if (found.some(q => q.externalId !== marker)) throw new OctoError('octo_deletion_proxy_unknown');
          for (const q of found) targets.add(normalizeUuid(q.uuid));
        }
        if (targets.size) {
          const proxies = await api.listProxies();
          const deleted: string[] = [];
          for (const uuid of targets) {
            await check();
            const others = (await store.list()).filter(q => q.id !== p.id);
            if (others.some(q => [q.proxy?.uuid, q.proxyChange?.uuid].some(id => id && normalizeUuid(id) === uuid))) continue;
            const proxy = proxies.find(q => normalizeUuid(q.uuid) === uuid);
            if (!proxy || proxy.profiles_count > 0) continue;
            if (proxy.profiles_count !== 0) throw new OctoError('octo_deletion_proxy_unknown');
            await check(); await api.deleteProxy(proxy.uuid); deleted.push(uuid);
          }
          if (deleted.length && (await api.listProxies()).some(q => deleted.includes(normalizeUuid(q.uuid))))
            throw new OctoError('octo_request_outcome_unknown');
        }
        p.deletion!.phase = 'purge'; p.deletion!.attempts = 0; p.deletion!.nextAttemptAt = 0; await save();
      }
    }
    if (p.deletion?.phase === 'purge') { await check(); await store.remove(p); }
  } catch (error) {
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(String((error as any)?.code))) throw error;
    if (!p.deletion) throw error;
    p.deletion.error = p.deletion.phase === 'verify' ? 'octo_deletion_confirmation_failed' : 'octo_deletion_cleanup_failed';
    if (!transientOctoError(error) || p.deletion.attempts >= 2) p.deletion.phase = 'blocked';
    else p.deletion.nextAttemptAt = now() + RETRY_MS;
    await save();
  }
}
