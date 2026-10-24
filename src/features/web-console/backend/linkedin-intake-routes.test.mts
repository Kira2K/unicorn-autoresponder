import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { LinkedInIntakeService } from '../../linkedin-automation/console-intake/service.mts';
const require = createRequire(import.meta.url), express = require('express') as typeof import('express');
const { registerLinkedInIntakeRoutes } = require('./linkedin-intake-routes.ts') as typeof import('./linkedin-intake-routes.ts');
test('owner-scoped intake ignores supplied client ID, denies other roles, never returns upstream diagnostics', async () => {
  let role = 'client', error: unknown, savedId = 0;
  const app = express(); app.use(express.json());
  const service = { async load(id: number) { assert.equal(id, 7); return { url: '' }; },
    async save(id: number) { if (error) throw error; savedId = id; return { saved: true }; } } as unknown as LinkedInIntakeService;
  registerLinkedInIntakeRoutes(app, (req: any, _res, next) => { req.webSession = { role, clientId: 7 }; next(); }, service);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server.once('listening', done));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/client/linkedin-intake`;
  try {
    const get = await fetch(url); assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await get.json(), { url: '' });
    role = 'admin'; assert.equal((await fetch(url)).status, 403);
    role = 'provider'; assert.equal((await fetch(url)).status, 403);
    role = 'client';
    const put = () => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"clientId":99}' });
    assert.equal((await put()).status, 200); assert.equal(savedId, 7);
    error = Object.assign(new Error('database password=private'), { code: 'postgres_failed' });
    assert.deepEqual(await (await put()).json(), { error: 'linkedin_intake_unavailable' });
    error = Object.assign(new Error('unknown'), { code: 'commit_uncertain' });
    assert.deepEqual(await (await put()).json(), { error: 'commit_uncertain' });
  } finally { await new Promise<void>(done => server.close(() => done())); }
});
