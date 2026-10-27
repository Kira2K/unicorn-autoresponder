import type { Express, Request, Response, RequestHandler } from 'express';
import type { OctoService } from '../../octo-access/service.mts';
type SessionRequest = Request & { webSession?: { role: string; clientId?: number } };
export function registerOctoRoutes(app: Express, requireAuth: RequestHandler, service?: OctoService) {
  const guard: RequestHandler = (req: SessionRequest, res, next) => {
    const id = req.webSession?.clientId;
    res.setHeader('Cache-Control', 'no-store');
    if (req.webSession?.role !== 'client' || !id || !service?.allowed(Number(id))) {
      res.status(403).json({ error: 'forbidden' }); return;
    }
    next();
  };
  const run = (fn: (req: SessionRequest) => Promise<unknown>, status = 200): RequestHandler => async (req, res: Response) => {
    try { res.status(status).json(await fn(req)); }
    catch (error) {
      const e = error as { code?: string; status?: number };
      const code = e.code && /^(octo_|forbidden$|not_found$|invalid_profile_id$)/.test(e.code) ? e.code : 'octo_operation_failed';
      res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 503).json({ error: code });
    }
  };
  app.get('/api/octo/profiles/status', requireAuth, guard, run(req => service!.status(Number(req.webSession!.clientId),
    { proxyCredentials: req.query.proxyCredentials === '1' })));
  app.post('/api/octo/onboarding', requireAuth, guard,
    run(req => service!.startOnboarding(Number(req.webSession!.clientId), req.body), 202));
  app.post('/api/octo/onboarding/:id/continue', requireAuth, guard,
    run(req => service!.continueOnboarding(Number(req.webSession!.clientId), String(req.params.id), req.body?.acceptLowScore), 202));
  app.put('/api/octo/nodemaven-key', requireAuth, guard,
    run(req => service!.saveNodeMavenKey(Number(req.webSession!.clientId), req.body?.key)));
  app.get('/api/octo/locations', requireAuth, guard,
    run(req => service!.locations(Number(req.webSession!.clientId), req.query.level, req.query.country, req.query.region)));
  app.post('/api/octo/profiles/ensure', requireAuth, guard, run(req => service!.ensure(Number(req.webSession!.clientId), req.body?.ownProxy === true), 202));
  app.post('/api/octo/grants', requireAuth, guard, run(req => service!.acquire(Number(req.webSession!.clientId), Number(req.body?.profileId)), 202));
  app.post('/api/octo/profiles/:id/proxy', requireAuth, guard,
    run(req => service!.saveProxy(Number(req.webSession!.clientId), Number(req.params.id), req.body), 202));
  app.get('/api/octo/grants/:id', requireAuth, guard, run(req => service!.grant(Number(req.webSession!.clientId), String(req.params.id))));
}
