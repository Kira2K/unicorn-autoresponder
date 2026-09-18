import express from 'express';
import { createRequire } from 'node:module';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import { createSqlConsoleRepository } from './repository.mts';
import { workflowScope } from './workflow-scope.mts';
import { workflowTestServices, type TestNotification } from './workflow-test-services.mts';
import { createSqlAuthTestService, linkedInTestRoute } from './linkedin-test-service.mts';
import type { AuthTestExecute } from './linkedin-contracts.mts';
import type { SqlFeatureServices } from './feature-services.mts';
const { createWebConsoleApp } = createRequire(import.meta.url)('../app.ts') as {
  createWebConsoleApp(options: { repository: ReturnType<typeof createSqlConsoleRepository>; useMockData: boolean }): express.Express;
};
const reads = new Set(['/api/auth/me', '/api/client/me', '/api/client/profile-options', '/api/platforms',
  '/api/provider/clients', '/api/admin/latest-client', '/api/admin/noco-queue', '/api/dolphin/profiles/status']);
// Dedicated test composition, not a switch of the production entrypoint or external services.
export function createSqlTestConsole(db: ConsoleSql, writes?: ConsoleWrites, workflow?: { notifications: TestNotification[] },
  linkedin?: { execute: AuthTestExecute }, features?: SqlFeatureServices) {
  const app = express();
  app.use((req, res, next) => {
    const auth = req.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(req.path);
    const read = req.method === 'GET' && reads.has(req.path);
    const write = (req.method === 'PATCH' && req.path === '/api/client/me') ||
      (req.method === 'POST' && req.path === '/api/client/platform-accounts') ||
      (['PATCH', 'DELETE'].includes(req.method) && /^\/api\/client\/platform-accounts\/[^/]+$/.test(req.path));
    if (!req.path.startsWith('/api/')) return next();
    const cv = workflow && writes?.clientIds.size && (
      (req.method === 'GET' && /^\/api\/bot\/telegram\/(chats\/[^/]+\/resume\/status|resume\/provider\/tasks|resume\/workflows\/\d+)$/.test(req.path)) ||
      (req.method === 'POST' && /^\/api\/bot\/telegram\/(chats\/[^/]+\/resume(?:\/reject|\/reset-test)?|resume\/workflows\/\d+\/(advance|reject)|resume\/(task-input|kira-comments))$/.test(req.path)));
    if (auth || read || write || cv || (linkedin && linkedInTestRoute(req.method, req.path)) ||
      (features && req.path.startsWith('/api/admin/linkedin/'))) return next();
    res.status(403).json({ error: 'sql_test_operation_disabled',
      message: 'Операция не входит в разрешённый SQL-тест. Внешние действия отключены.' });
  });
  const repository = createSqlConsoleRepository(db, writes);
  app.use(createWebConsoleApp({
    repository: workflow ? workflowScope(repository, writes?.clientIds ?? new Set()) : repository,
    useMockData: true, ...workflowTestServices(workflow?.notifications ?? []),
    ...(linkedin ? { linkedinAuthRuns: createSqlAuthTestService(db, linkedin.execute, writes) } : {}), ...features
  }));
  return app;
}
