// Production adaptation of octo-access-test/timed-workflow: protect, publish, hide,
// then clear only after ordinary closure. Dependencies deliberately have no stop API.
import { OctoError } from './contracts.mts';
import type { CloudApi, Grant, ManagedProfile, Metadata, OctoConfig, OctoStore } from './contracts.mts';
import { inFolder, safeCode } from './provision.mts';
import { normalizeUuid } from './cloud-api.mts';
const sameMetadata = (p: Metadata, m: Metadata) => p.title === m.title && p.description === m.description
  && JSON.stringify(p.tags ?? []) === JSON.stringify(m.tags) && JSON.stringify(p.start_pages) === JSON.stringify(m.start_pages);
export async function advanceGrant(initial: ManagedProfile, deps: {
  store: OctoStore; api: CloudApi; config: OctoConfig; check(): Promise<void>; now?: () => number;
  historyCheckpoint?: () => string | number | undefined;
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
    const stream = await store.stream();
    if (stream.coverageSince > g.createdAt) throw new OctoError('octo_event_history_gap');
    const events = (await store.events(p.uuid!, g.eventsAfter)).filter(e => e.time * 1000 >= Math.floor(g.createdAt / 1000) * 1000);
    if (events.some(e => e.action === 'profiles.force_stopped')) throw new OctoError('octo_force_stop_observed');
    const lifecycle = events.filter(e => ['profiles.started', 'profiles.stopped'].includes(e.action));
    const started = lifecycle.some(e => e.action === 'profiles.started');
    const normallyClosed = started && lifecycle.at(-1)?.action === 'profiles.stopped';
    // A matching update after hide is a positive ordering barrier: the stream has
    // replayed the complete exposure interval. Absence of start alone is not proof.
    const hideBarrier = events.some(e => e.action === 'profiles.updated'
      && e.title === g.original.title && e.time >= Math.floor(g.hiddenAt! / 1000));
    const neverOpened = !lifecycle.length && hideBarrier;
    if (live.status !== 0 || !hideBarrier || (!normallyClosed && !neverOpened)) return;
    if (p.proxy && await proxyTitle() !== g.originalProxyTitle) {
      await write('restore_proxy', () => api.updateProxy(p.proxy!.uuid, g.originalProxyTitle!));
      if (await proxyTitle() !== g.originalProxyTitle) throw new OctoError('octo_proxy_write_unknown');
      await resolved();
    }
    await write('clear', async () => {
      // The inbox was read across SQL/network awaits. A new page or disconnect
      // invalidates that decision, even if the new page has already drained.
      if (historyCheckpoint() !== checkpoint) throw new OctoError('octo_event_history_pending');
      await api.clearPassword(p.uuid!, p.password);
    });
    live = await read();
    if (live.has_user_password || !inFolder(live, config.homeFolder) || !sameMetadata(live as Metadata, g.original))
      throw new OctoError('octo_clear_unverified');
    await complete();
  } catch (error) {
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(String((error as any)?.code))) throw error;
    if (g.pending === 'clear' && (error as any)?.code === 'octo_event_history_pending') {
      // The request was never sent; do not leave an uncertain-write journal.
      g.phase = 'awaiting_close'; delete g.pending; delete g.attemptedAt; g.error = 'octo_event_history_pending';
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
