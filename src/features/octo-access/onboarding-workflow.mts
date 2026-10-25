import { OctoError } from './contracts.mts';
import type { OctoStore, ManagedProfile, ProxyInput } from './contracts.mts';
import type { ClientState } from './onboarding-contracts.mts';
import type { OnboardingDependencies } from './onboarding-service.mts';
import { parseOwnSocksProxy } from './own-proxy-string.mts';
import { safeCode } from './provision.mts';

const proxyUrl = (p: ProxyInput) => 'socks5h://' +
  (p.login || p.password ? encodeURIComponent(p.login) + ':' + encodeURIComponent(p.password) + '@' : '') + p.host + ':' + p.port;

export async function advanceOnboarding(initial: ClientState, deps: OnboardingDependencies & {
  store: OctoStore; check(): Promise<void>; now?: () => number;
  allowLegacyChecks?: boolean;
  reserve(clientId: number): Promise<ManagedProfile[]>;
  saveProxy(clientId: number, profileId: number, input: ProxyInput, operationId: string): Promise<unknown>;
}) {
  let state = initial, setup = state.setup;
  if (!setup || ['complete','blocked','unknown','awaiting_confirmation'].includes(setup.phase)) return;
  const save = async () => { await deps.check(); state.setup = setup; state = await deps.store.saveClientState(state); setup = state.setup!; };
  const now = deps.now ?? Date.now;
  try {
    if (setup.phase === 'checking') {
      setup.phase = 'unknown'; setup.error = 'octo_proxy_check_unknown'; await save(); return;
    }
    if (setup.phase === 'queued') {
      if (deps.allowLegacyChecks === false && !['manual','direct','none'].includes(setup.source)) {
        setup.phase = 'blocked'; setup.error = 'octo_legacy_proxy_setup_retired'; await save(); return;
      }
      setup.phase = 'checking'; setup.startedAt = now(); await save(); await deps.check();
      const result = setup.source === 'nodemaven'
        ? await deps.checker.best(state.nodeMavenKey!, setup.location!)
        : await deps.checker.check(proxyUrl(setup.input!));
      if (!result.ok || !result.proxy_url || typeof result.final_score !== 'number' || !Number.isFinite(result.final_score))
        throw new OctoError('octo_proxy_check_failed', 502);
      setup.input = parseOwnSocksProxy(result.proxy_url); setup.score = result.final_score;
      setup.phase = setup.source !== 'nodemaven' && result.final_score < 70 ? 'awaiting_confirmation' : 'provisioning';
      await save();
      if (setup.phase === 'awaiting_confirmation') return;
    }
    if (setup.phase === 'provisioning') {
      await deps.check();
      const profiles = await deps.reserve(state.clientId);
      if (!setup.profileIds) { setup.profileIds = profiles.map(p => p.id); await save(); }
      if (profiles.some(p => p.phase === 'blocked')) throw new OctoError('octo_profile_creation_failed', 502);
      if (profiles.some(p => p.phase !== 'ready')) return;
      if (!['none','direct'].includes(setup.source)) {
        const en = profiles.find(p => p.locale === 'en');
        if (!en) throw new OctoError('octo_en_profile_missing', 409);
        if (!en.proxyChange) {
          if (!setup.input) throw new OctoError('octo_proxy_setup_required', 409);
          await deps.check(); await deps.saveProxy(state.clientId, en.id, setup.input, setup.id); return;
        }
        if (en.proxyChange.phase === 'blocked') throw new OctoError('octo_proxy_attachment_failed', 502);
        if (en.proxyChange.id !== setup.id || (en.proxyChange.input && JSON.stringify(en.proxyChange.input) !== JSON.stringify(setup.input)))
          throw new OctoError('octo_proxy_attachment_mismatch', 409);
        if (en.proxyChange.phase !== 'complete' || !en.proxy) return;
      }
      setup.phase = 'complete'; setup.completedAt = now(); delete setup.input; await save();
    }
  } catch (error) {
    const code = String((error as {code?: string}).code);
    if (/^(postgres_|octo_stale_revision|commit_|octo_leadership)/.test(code)) throw error;
    setup!.phase = code === 'octo_proxy_check_unknown' ? 'unknown' : 'blocked';
    setup!.error = safeCode(error); await save();
  }
}
