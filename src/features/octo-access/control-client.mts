import { OctoError } from './contracts.mts';
import type { OctoConfig, OctoStore } from './contracts.mts';
import type { OctoService } from './service.mts';
import { controlIdentity } from './control-identity.mts';
import { controlPath } from './control-routes.mts';
import { readGrantCandidate } from './acquire-profile.mts';

export function createControlAcquire(deps: {
  url: string; secret: string; store: Pick<OctoStore, 'get' | 'clientState'>; config: OctoConfig;
  allowed: OctoService['allowed']; fetch?: typeof fetch; timeoutMs?: number;
}): OctoService['acquire'] {
  const request = async (path: string, body: unknown) => {
    const response = await (deps.fetch ?? fetch)(deps.url + controlPath + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      headers: { Authorization: `Bearer ${deps.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      const code = typeof data?.error === 'string' && /^(octo_[a-z0-9_]+|forbidden|not_found|invalid_profile_id)$/.test(data.error)
        ? data.error : 'octo_control_unavailable';
      throw new OctoError(code, response.status >= 400 && response.status <= 599 ? response.status : 503);
    }
    return data;
  };
  return async (clientId, profileId) => {
    if (!deps.allowed(clientId)) throw new OctoError('forbidden', 403);
    const { profile: before, existing } = await readGrantCandidate(deps.store, clientId, profileId);
    if (existing) return existing;
    const identity = controlIdentity(before, deps.config), body = { clientId, profileId, identity };
    try {
      const health = await request('/ready', body);
      if (health?.ready !== true || health.identity !== identity) throw new OctoError('octo_control_profile_mismatch', 409);
    } catch (e) {
      if (e instanceof OctoError) throw e;
      throw new OctoError('octo_control_unavailable', 503);
    }
    // Exactly one mutation request. A timeout can mean the server committed it.
    let result: unknown, failed: unknown;
    try { result = await request('/grants', body); } catch (e) { failed = e; }
    let current;
    try { current = await deps.store.get(profileId); }
    catch { throw new OctoError('octo_control_uncertain', 503); }
    if (!current || controlIdentity(current, deps.config) !== identity)
      throw new OctoError('octo_control_profile_mismatch', 409);
    const g = current.grant;
    const returned = result as { id?: string; phase?: string } | undefined;
    if (g && ((!failed && returned?.id === g.id) ||
        (failed &&
          (g.id !== before.grant?.id || ['preparing', 'granted'].includes(g.phase)))))
      return { id: g.id, phase: g.phase };
    if (failed instanceof OctoError) throw failed;
    throw new OctoError('octo_control_uncertain', 503);
  };
}
