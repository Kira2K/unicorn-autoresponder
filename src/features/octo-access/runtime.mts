import { createActionLogListener } from '../octo-access-test/action-log.mts';
import { createOctoService } from './service.mts';
import { provisionProfile, safeCode } from './provision.mts';
import { advanceGrant } from './grant-workflow.mts';
import { advanceProxy } from './proxy-workflow.mts';
import { OctoError } from './contracts.mts';
import type { CloudApi, OctoConfig, OctoStore } from './contracts.mts';
import type { WebClient } from '../web-console/backend/types.ts';
import type { OnboardingDependencies } from './onboarding-service.mts';
import { advanceOnboarding } from './onboarding-workflow.mts';
import { octoClientAllowed } from './access-policy.mts';
import { advanceDeletion } from './deletion-workflow.mts';
export function createOctoRuntime({ store, api, config, token, getClient, now = Date.now,
  listen = createActionLogListener, report = () => {}, onboarding }: {
  store: OctoStore; api: CloudApi; config: OctoConfig; token: string; getClient(id: number): Promise<WebClient>;
  now?: () => number; listen?: typeof createActionLogListener; report?: (event: { code: string; profileId?: number }) => void;
  onboarding?: OnboardingDependencies;
}) {
  let lease: Awaited<ReturnType<OctoStore['leader']>>, listener: ReturnType<typeof listen> | undefined;
  let signature = '', stopped = true, timer: ReturnType<typeof setTimeout> | undefined, work: Promise<void> | undefined;
  let lastError: string | undefined;
  let listenerGeneration = 0;
  const jobs = new Map<number, Promise<void>>();
  const setupJobs = new Map<number, Promise<void>>();
  let creating = false;
  const checked = async () => {
    if (stopped || !lease) throw new OctoError('octo_leadership_lost');
    try { await lease.check(); } catch { throw new OctoError('octo_leadership_lost'); }
  };
  const service = createOctoService({ store, config, getClient, now, onboarding,
    canGrant: uuid => !!lease && listener?.status().checkpoint !== undefined && signature.split(',').includes(uuid) && !lastError });
  async function disconnect() {
    await listener?.stop(); listener = undefined; signature = '';
    const previous = lease; lease = undefined; await previous?.release();
  }
  const nextCheck = new Map<number, number>();
  function launch(id: number, operation: (check: () => Promise<void>) => Promise<void>, deleting = false) {
    const owned = lease;
    const check = async () => {
      if (!owned || lease !== owned) throw new OctoError('octo_leadership_lost'); await checked();
      const current = await store.get(id);
      if (!current || (!deleting && current.deletion)) throw new OctoError('octo_stale_revision');
    };
    const job = operation(check).catch(error => {
      if ((error as any)?.code !== 'octo_stale_revision') report({ code: safeCode(error), profileId: id });
    }).finally(() => { jobs.delete(id); });
    jobs.set(id, job);
  }
  async function tick() {
    if (stopped) return;
    try {
      lease ??= await store.leader();
      if (!lease) return;
      await checked();
      const profiles = await store.list();
      const ids = profiles.flatMap(p => p.uuid ? [p.uuid] : []).sort(), current = ids.join(',');
      if (!listener || signature !== current) {
        await listener?.stop();
        let cursor = (await store.stream()).cursor;
        listenerGeneration++;
        listener = listen({ token, profileIds: ids, includeUpdates: true, includeDeletions: true, requireCompleteHistory: true, now, loadCursor: () => cursor,
          onReplayGap: since => store.setCoverage(since),
          onPage: async page => {
            await checked(); await store.recordPage(page); cursor = page.watermark;
            for (const p of profiles) if (page.events.some(e => e.profileId.replaceAll('-', '') === p.uuid)) nextCheck.delete(p.id);
          } });
        signature = current; listener.start();
      }
      lastError = undefined;
      for (const p of profiles.filter(p => p.deletion && p.deletion.phase !== 'blocked' && p.deletion.nextAttemptAt <= now())) {
        if (jobs.has(p.id) || setupJobs.has(p.clientId)) continue;
        launch(p.id, async check => {
          await advanceDeletion(p, { store, api, check, now });
          const current = await store.get(p.id);
          if (current?.deletion?.error) report({ code: current.deletion.error, profileId: p.id });
          if (!current) nextCheck.delete(p.id);
        }, true);
      }
      // Expiry is independent of stream connectivity and of unrelated provisioning.
      for (const p of profiles.filter(p => !p.deletion && p.grant && p.grant.phase !== 'complete')) {
        if (jobs.has(p.id) || (p.grant!.phase !== 'preparing' && (nextCheck.get(p.id) ?? 0) > now())) continue;
        launch(p.id, async check => {
          await advanceGrant(p, { store, api, config, now, check, historyCheckpoint: () => {
            const checkpoint = listener?.status().checkpoint;
            return checkpoint === undefined ? undefined : `${listenerGeneration}:${checkpoint}`;
          } });
          const current = await store.get(p.id), grant = current?.grant;
          const delay = grant?.phase === 'granted' && !grant.error ? Math.min(30_000, Math.max(0, grant.expiresAt! - now())) : 30_000;
          nextCheck.set(p.id, now() + delay);
          if (grant?.error) report({ code: grant.error, profileId: p.id });
        });
      }
      // Sequential creation makes pool-proxy reservation deterministic; it never
      // serializes access grants or stores a transaction across a network call.
      for (const p of profiles.filter(p => !p.deletion && p.phase !== 'ready' && (!p.error || p.pending))) {
        if (creating || jobs.has(p.id) || !octoClientAllowed(config, p.clientId) || (nextCheck.get(p.id) ?? 0) > now()) continue;
        creating = true;
        launch(p.id, async check => {
          try {
            const folders = await api.listFolders();
            if (![config.homeFolder, config.guestFolder].every(id => folders.some(f => f.uuid === id))) throw new OctoError('octo_folders_changed');
            await provisionProfile(p, { store, api, config, check }); nextCheck.set(p.id, now() + 30_000);
          } finally { creating = false; }
        });
      }
      for (const p of profiles.filter(p => !p.deletion && p.proxyChange && p.proxyChange.phase !== 'complete' &&
        (p.proxyChange.phase !== 'blocked' || p.proxyChange.pending))) {
        if (jobs.has(p.id) || !octoClientAllowed(config, p.clientId) ||
          (p.proxyChange!.phase !== 'queued' && (nextCheck.get(p.id) ?? 0) > now())) continue;
        launch(p.id, async check => { await advanceProxy(p, { store, api, config, check }); nextCheck.set(p.id, now() + 30_000); });
      }
      for (const state of await store.clientStates()) {
        if (!state.setup || !['queued','checking','provisioning'].includes(state.setup.phase) ||
          !octoClientAllowed(config, state.clientId) || setupJobs.has(state.clientId) || setupJobs.size >= 2 ||
          profiles.some(p => p.clientId === state.clientId && p.deletion)) continue;
        const owned = lease;
        const check = async () => {
          if (!owned || lease !== owned) throw new OctoError('octo_leadership_lost'); await checked();
          if ((await store.list(state.clientId)).some(p => p.deletion) ||
              (await store.clientState(state.clientId))?.setup?.id !== state.setup?.id) throw new OctoError('octo_stale_revision');
        };
        const unavailable = async (): Promise<never> => { throw new OctoError('octo_checker_configuration_required', 503); };
        const dependencies = onboarding ?? { checker: { check: unavailable, best: unavailable },
          catalogue: { list: unavailable, validate: unavailable }, dolphin: { list: async () => [], proxy: unavailable } };
        const job = advanceOnboarding(state, { ...dependencies, store, check, now,
          reserve: id => service.reserve(id, true),
          saveProxy: (clientId, id, input, operationId) => service.queueProxy(clientId, id, input, operationId)
        }).catch(error => report({ code: safeCode(error) })).finally(() => { setupJobs.delete(state.clientId); });
        setupJobs.set(state.clientId, job);
      }
    } catch (error) {
      lastError = safeCode(error); report({ code: lastError });
      await disconnect().catch(() => {});
    }
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => { work = tick().finally(() => { work = undefined; schedule(); }); }, 1000);
    timer.unref();
  }
  return {
    service,
    status: () => ({ running: !stopped, leader: !!lease, connected: listener?.status().connected ?? false, error: lastError }),
    async start() {
      if (!stopped) return; await store.checkSchema(); stopped = false;
      work = tick(); await work; work = undefined; schedule();
    },
    async stop() {
      if (stopped) return; stopped = true; if (timer) clearTimeout(timer);
      onboarding?.checker.cancel?.();
      await work?.catch(() => {}); await Promise.all([...jobs.values(), ...setupJobs.values()]); await disconnect();
    }
  };
}
