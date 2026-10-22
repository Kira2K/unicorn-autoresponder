import { createRequire } from 'node:module';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { createBridgeBroker } from './broker.mts';
import type { BridgeConfig } from './config.mts';
const express = createRequire(import.meta.url)('express') as typeof import('express');
export const bridgePath = '/internal/octo-bridge/v1';
export function bridgeRoutes(broker: ReturnType<typeof createBridgeBroker>, config: BridgeConfig) {
  const router = express.Router(), hash = (s: string) => createHash('sha256').update(s).digest();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const auth = req.get('authorization') ?? '';
    if (!timingSafeEqual(hash(auth), hash(`Bearer ${config.secret}`))) return void res.status(401).json({ error: 'octo_bridge_unauthorized' });
    next();
  });
  router.use(express.json({ limit: '4kb' }));
  router.use((req, res, next) => {
    if (req.method === 'GET' && req.path === '/health') return next();
    if (req.method !== 'POST' || !['/poll','/authorize','/result'].includes(req.path) || !req.body ||
      Object.keys(req.body).some(k => !['deviceId','id','result','profileUuids'].includes(k)))
      return void res.status(400).json({ error: 'octo_bridge_invalid_request' });
    next();
  });
  router.get('/health', async (_req, res, next) => { try { res.json(await broker.health()); } catch (e) { next(e); } });
  router.post('/poll', async (req, res, next) => {
    try {
      if (!Array.isArray(req.body.profileUuids) && req.body.profileUuids !== 'managed')
        return void res.status(400).json({ error: 'octo_bridge_invalid_scope' });
      const task = await broker.poll(req.body.deviceId, req.body.profileUuids === 'managed' ? undefined : req.body.profileUuids); res.json({ task });
    } catch (e) { next(e); }
  });
  router.post('/authorize', async (req, res, next) => {
    try { res.json(await broker.authorize(req.body.deviceId, req.body.id)); } catch (e) { next(e); }
  });
  router.post('/result', async (req, res, next) => {
    try { res.json(await broker.result(req.body.deviceId, req.body.id, req.body.result)); } catch (e) { next(e); }
  });
  router.use(((error, _req, res, _next) => {
    const e = error as { code?: string; status?: number };
    res.status(Number.isInteger(e.status) && e.status! >= 400 && e.status! <= 599 ? e.status! : 503)
      .json({ error: /^(octo_bridge_|octo_event_|octo_force_|octo_stale_)[a-z0-9_]+$/.test(e.code ?? '') ? e.code : 'octo_bridge_unavailable' });
  }) as import('express').ErrorRequestHandler);
  return router;
}
