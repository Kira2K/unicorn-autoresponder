import { createRequire } from 'node:module';
import { createHash, timingSafeEqual } from 'node:crypto';
import { OctoError } from './contracts.mts';
import type { OctoConfig, OctoStore } from './contracts.mts';
import type { OctoService } from './service.mts';
import { controlIdentity } from './control-identity.mts';
const express = createRequire(import.meta.url)('express') as typeof import('express');
export const controlPath = '/internal/octo-control/v1';

export function controlRoutes(deps: {
  secret: string; store: Pick<OctoStore, 'get'>; config: OctoConfig;
  service: Pick<OctoService, 'acquire' | 'allowed'>; ready(uuid: string): Promise<boolean>;
}) {
  const router = express.Router(), hash = (s: string) => createHash('sha256').update(s).digest();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!timingSafeEqual(hash(req.get('authorization') ?? ''), hash(`Bearer ${deps.secret}`)))
      return void res.status(401).json({ error: 'octo_control_unauthorized' });
    // A service credential is required; browser cookie sessions never authorize this route.
    if (req.get('origin')) return void res.status(403).json({ error: 'forbidden' });
    next();
  });
  router.use(express.json({ limit: '4kb' }));
  router.post(['/ready', '/grants'], async (req, res, next) => {
    try {
      const b = req.body;
      if (!b || Object.keys(b).some(k => !['clientId', 'profileId', 'identity'].includes(k)) ||
          ![b.clientId, b.profileId].every(id => Number.isSafeInteger(id) && id > 0) ||
          typeof b.identity !== 'string' || !/^[a-f0-9]{64}$/.test(b.identity))
        throw new OctoError('octo_control_invalid_request', 400);
      if (!deps.service.allowed(b.clientId)) throw new OctoError('forbidden', 403);
      const p = await deps.store.get(b.profileId);
      if (!p || p.clientId !== b.clientId) throw new OctoError('not_found', 404);
      if (controlIdentity(p, deps.config) !== b.identity) throw new OctoError('octo_control_profile_mismatch', 409);
      if (!p.uuid || !(await deps.ready(p.uuid))) throw new OctoError('octo_listener_unavailable', 503);
      if (req.path === '/ready') return void res.json({ ready: true, identity: b.identity });
      res.status(202).json(await deps.service.acquire(b.clientId, b.profileId));
    } catch (e) { next(e); }
  });
  router.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  router.use(((error, _req, res, _next) => {
    const e = error as { code?: string; status?: number };
    const known = /^(octo_[a-z0-9_]+|forbidden|not_found|invalid_profile_id)$/.test(e.code ?? '');
    res.status(known && e.status && e.status >= 400 && e.status <= 599 ? e.status : 503)
      .json({ error: known ? e.code : 'octo_control_unavailable' });
  }) as import('express').ErrorRequestHandler);
  return router;
}

// Mount before Console's auth/static fallbacks, including previews using the same app.
export function withControlRoutes(app: import('express').Express, routes?: import('express').Router) {
  if (!routes) return app;
  const outer = express();
  outer.use(controlPath, routes); outer.use(app);
  Object.assign(outer.locals, app.locals);
  return outer;
}
