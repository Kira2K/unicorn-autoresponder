// Production adaptation of octo-access-test/timed-workflow: protect, publish, hide,
// then clear only after ordinary closure. Dependencies deliberately have no stop API.
import { OctoError } from './contracts.mts';
import type { CloudApi, Grant, ManagedProfile, Metadata, OctoConfig, OctoStore } from './contracts.mts';
import { inFolder, safeCode } from './provision.mts';
import { normalizeUuid } from './cloud-api.mts';
import { cleanupHistoryReady, sameMetadata } from './cleanup-readiness.mts';
export async function advanceGrant(initial: ManagedProfile, deps: {
  store: OctoStore; api: CloudApi; config: OctoConfig; check(): Promise<void>; now?: () => number;
  historyCheckpoint?: () => string | number | undefined;
  passwordBridge?: { id: string; ownerEmail: string };
}) {
  const { store, api, config, check, now = Date.now, historyCheckpoint = () => 0 } = deps;
  let p = initial;
  if (!p.uuid || !p.grant || p.grant.phase === 'complete') return;
  let g = p.grant;
  if (g.phase === 'granted' && !g.pending && now() < g.expiresAt!) return;
  const anon: Metadata = { title: g.alias, description: `unicorn-access:${g.id}`, tags: [], start_pages: [] };
  const save = async () => { await check(); p.grant = g; p = await store.save(p); g = p.grant!; };
  const read = async () => {
    const live = await api.getProfile(p.uuid!);
    if (normalizeUuid(live.uuid) !== normalizeUuid(p.uuid!)) throw new OctoError('octo_profile_changed');
    return live;
  };
  const write = async (step: Grant['pending'], fn: () => Promise<void>) => {
    g.pending = step; g.attemptedAt = now(); await save(); await check(); await fn();
  };
  const resolved = async () => { delete g.pending; delete g.attemptedAt; delete g.error; await save(); };
  const finishPublication = async (at: number) => {
    g.phase = 'granted'; g.grantedAt = at; g.expiresAt = at + config.leaseMs; await resolved();
  };
  const finishHide = async (at: number) => { g.phase = 'awaiting_close'; g.hiddenAt = at; await resolved(); };
  const complete = async () => { g.phase = 'complete'; g.completedAt = now(); await resolved(); };
  async function proxyTitle() {
    const proxy = (await api.listProxies()).find(q => q.uuid === p.proxy?.uuid);
    if (!proxy || proxy.profiles_count !== 1) throw new OctoError('octo_proxy_changed');
    return proxy.title;
  }
  try {
    let live = await read();
    if (g.pending) {
      // First reconcile interrupted writes. Retrying the same restrictive hide is
      // safe only while this grant's protected anonymous profile is still shared.
      const step = g.pending, at = g.attemptedAt!;
      if (step === 'clear' && g.clearMethod === 'bridge') {
        const receipt = g.bridgeClear?.result;
        if (!receipt) {
          if (g.phase === 'blocked') return;
          if (g.error !== 'octo_bridge_waiting' || g.phase !== 'awaiting_close') {
            g.phase = 'awaiting_close'; g.error = 'octo_bridge_waiting'; await save();
          }
          return;
        }
        if (receipt.state !== 'succeeded') throw new OctoError(receipt.state === 'uncertain'
          ? 'octo_bridge_outcome_unknown' : 'octo_bridge_clear_rejected');
        if (live.has_user_password || live.status !== 0 || !inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original))
          throw new OctoError('octo_clear_unverified');
        await complete(); return;
      }
      if (step === 'protect' && inFolder(live, config.homeFolder) && sameMetadata(live as Metadata, g.original) && live.has_user_password) {
        g.phase = 'preparing'; await resolved();
      } else if (step === 'mask_proxy' && await proxyTitle() === g.alias) { g.phase = 'preparing'; await resolved(); }
      else if (step === 'publish' && inFolder(live, config.guestFolder) && sameMetadata(live as Metadata, anon) && live.has_user_password)
        await finishPublication(at);
      else if (step === 'hide' && inFolder(live, config.homeFolder) && sameMetadata(live as Metadata, g.original)) await finishHide(at);
      else if (step === 'hide' && inFolder(live, config.guestFolder) && sameMetadata(live as Metadata, anon) && live.has_user_password) {
        await check(); await api.updateProfile(p.uuid!, { ...g.original, folder: config.homeFolder });
        live = await read();
        if (!inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original)) throw new OctoError('octo_hide_unverified');
        await finishHide(now());
      }
      else if (step === 'restore_proxy' && await proxyTitle() === g.originalProxyTitle) { g.phase = 'awaiting_close'; await resolved(); }
      else if (step === 'clear' && inFolder(live, config.homeFolder) && sameMetadata(live as Metadata, g.original) && !live.has_user_password) {
        await complete(); return;
      } else throw new OctoError('octo_write_outcome_unknown');
    }
    if (g.phase === 'blocked') return;
    if (g.phase === 'preparing') {
      if (!inFolder(live, config.homeFolder) || live.status !== 0 || !sameMetadata(live as Metadata, g.original))
        throw new OctoError('octo_profile_not_idle');
      await api.validateGuest(config.guest.email, config.guestFolder);
      if (!live.has_user_password) {
        await write('protect', () => api.setPassword(p.uuid!, p.password));
        live = await read();
        if (!live.has_user_password) throw new OctoError('octo_protection_unverified');
        await resolved();
      }
      if (p.proxy && await proxyTitle() !== g.alias) {
        await write('mask_proxy', () => api.updateProxy(p.proxy!.uuid, g.alias));
        if (await proxyTitle() !== g.alias) throw new OctoError('octo_proxy_write_unknown');
        await resolved();
      }
      await write('publish', () => api.updateProfile(p.uuid!, { ...anon, folder: config.guestFolder }));
      live = await read();
      if (!inFolder(live, config.guestFolder) || !sameMetadata(live as Metadata, anon) || !live.has_user_password)
        throw new OctoError('octo_publish_unverified');
      await finishPublication(now());
    }
    if (g.phase === 'granted') {
      if (now() < g.expiresAt!) return;
      await write('hide', () => api.updateProfile(p.uuid!, { ...g.original, folder: config.homeFolder }));
      live = await read();
      if (!inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original)) throw new OctoError('octo_hide_unverified');
      await finishHide(g.attemptedAt!);
    }
    if (g.phase !== 'awaiting_close') return;
    const checkpoint = historyCheckpoint();
    if (checkpoint === undefined) return;
    live = await read();
    if (!inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original)) throw new OctoError('octo_private_profile_changed');
    if (!live.has_user_password) throw new OctoError('octo_password_changed_externally');
    if (live.status !== 0 || !await cleanupHistoryReady(p, store)) return;
    if (p.proxy && await proxyTitle() !== g.originalProxyTitle) {
      await write('restore_proxy', () => api.updateProxy(p.proxy!.uuid, g.originalProxyTitle!));
      if (await proxyTitle() !== g.originalProxyTitle) throw new OctoError('octo_proxy_write_unknown');
      await resolved();
    }
    if (deps.passwordBridge) {
      g.clearMethod = 'bridge'; g.bridgeClear = { bridgeId: deps.passwordBridge.id, ownerEmail: deps.passwordBridge.ownerEmail };
    }
    await write('clear', async () => {
      // The inbox was read across SQL/network awaits. A new page or disconnect
      // invalidates that decision, even if the new page has already drained.
      if (historyCheckpoint() !== checkpoint) throw new OctoError('octo_event_history_pending');
      if (g.clearMethod !== 'bridge') await api.clearPassword(p.uuid!, p.password);
    });
    if (g.clearMethod === 'bridge') {
      g.error = 'octo_bridge_waiting'; await save(); return;
    }
    live = await read();
    if (live.has_user_password || !inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original))
      throw new OctoError('octo_clear_unverified');
    await complete();
  } catch (error) {
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(String((error as any)?.code))) throw error;
    if (g.pending === 'clear' && (error as any)?.code === 'octo_event_history_pending') {
      // The request was never sent; do not leave an uncertain-write journal.
      g.phase = 'awaiting_close'; delete g.pending; delete g.attemptedAt; g.error = 'octo_event_history_pending';
      delete g.clearMethod; delete g.bridgeClear;
    } else if (g.pending === 'clear' && error instanceof OctoError && error.details?.upstreamCode === 'profiles.password_error') {
      // Explicit refusal can be retried: cloud synchronization can lag normal stop.
      g.phase = 'awaiting_close'; delete g.pending; delete g.attemptedAt; g.error = 'octo_waiting_for_sync';
    } else if (!g.pending && ['granted','awaiting_close'].includes(g.phase)
      && ['octo_request_outcome_unknown','octo_request_failed','invalid_octo_response'].includes((error as any)?.code)) {
      // A temporary read failure must never turn an exposed grant into a terminal
      // block that prevents its deadline from being enforced.
      g.error = safeCode(error);
    } else { g.phase = 'blocked'; g.error = safeCode(error); }
    await save();
  }
}
