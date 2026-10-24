// Dedicated, opt-in live E2E composition: only Denis, Octo control/bridge and static UI.
// No bot, scheduler, recovery pass, lifecycle or LinkedIn automation is started.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url), express = require('express');
const { createWebConsoleApp } = require('../backend/app.ts');
const { openSqlConsole } = await import('../backend/postgres/runtime.mts');
const { withBridgeRoutes } = await import('../../octo-access/bridge/app.mts');
const { withControlRoutes } = await import('../../octo-access/control-routes.mts');
async function main() {
if (process.env.LINKEDIN_CREATOR_E2E_STAGING !== '1' || process.env.APP_DB !== 'postgres' ||
    process.env.OCTO_PASSWORD_CLEANUP !== 'bridge' || !process.env.OCTO_CONTROL_SECRET || process.env.OCTO_CONTROL_URL ||
    process.env.CLIENT_LIFECYCLE_ENABLED === '1' || process.env.LINKLAB_ENABLED === '1')
  throw Error('denis_e2e_staging_configuration_required');
// The stand builds while production still owns the SQL lease; activation is explicit.
const runtime = await openSqlConsole(process.env);
const app = express();
app.get('/health', (_r: unknown, s: import('express').Response) => s.json({ mode: 'denis-e2e', enabled: process.env.OCTO_ENABLED === '1' }));
app.use((r: import('express').Request, s: import('express').Response, next: import('express').NextFunction) => {
  if (!r.path.startsWith('/api/') || /^\/api\/(auth\/(login|logout|me)|linkedin-creator(?:\/|$))/.test(r.path)) return next();
  s.status(404).json({ error: 'not_found' });
});
app.use(withControlRoutes(withBridgeRoutes(createWebConsoleApp({ ...runtime.options,
  useMockData: true, initializeConnectionInviter: false }), runtime.octoBridge), runtime.octoControl));
app.use(express.static(resolve('dist/web-console')));
app.use((r: import('express').Request, s: import('express').Response) => r.path.startsWith('/api/') || r.path.startsWith('/internal/')
  ? s.status(404).json({ error: 'not_found' }) : s.sendFile(resolve('dist/web-console/index.html')));
const server = app.listen(Number(process.env.PORT || 4302), process.env.WEB_CONSOLE_HOST || '0.0.0.0');
if (process.env.OCTO_ENABLED === '1') await runtime.startBackground();
let stopping = false;
const stop = () => { if (stopping) return; stopping = true; server.close(); void runtime.close(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
console.log(JSON.stringify({ mode: 'denis-e2e', workerEnabled: process.env.OCTO_ENABLED === '1' }));
}
void main().catch(() => { console.error(JSON.stringify({ error: 'denis_e2e_staging_start_failed' })); process.exitCode = 1; });
