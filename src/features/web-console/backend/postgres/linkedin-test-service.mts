import { createRequire } from 'node:module';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import type { AuthTestExecute, AuthRepository, AuthHistory } from './linkedin-contracts.mts';
import type { LinkedInAuthRunService } from '../linkedin-auth-types.ts';
const require = createRequire(import.meta.url);
const { createLinkedInAuthRunService } = require('../linkedin-auth-runs.ts') as {
  createLinkedInAuthRunService(options: { repository: AuthRepository; history: AuthHistory;
    execute: AuthTestExecute; gate: unknown }): LinkedInAuthRunService };
const { createLinkedInOperationGate } = require('../linkedin-operation-gate.ts') as {
  createLinkedInOperationGate(): unknown };
export function createSqlAuthTestService(db: ConsoleSql, execute: AuthTestExecute, grant?: ConsoleWrites, gate?: unknown) {
  if (typeof execute !== 'function') throw new PostgresReadError('sql_linkedin_fake_executor_required');
  const storage = createSqlLinkedInStorage(db, grant);
  const service = createLinkedInAuthRunService({ ...storage, execute, gate: gate ?? createLinkedInOperationGate() });
  return { ...service, async start(id, action) {
    const account = await storage.repository.getAccount(id, { fresh: true });
    if (!account || !grant?.clientIds.has(account.clientId)) throw new PostgresReadError('sql_linkedin_write_forbidden');
    return service.start(id, action);
  } } satisfies LinkedInAuthRunService;
}
export function linkedInTestRoute(method: string, path: string) {
  return (method === 'GET' && (path === '/api/admin/linkedin/accounts' ||
    /^\/api\/admin\/linkedin\/runs(?:\/[^/]+)?$/.test(path))) ||
    (method === 'PATCH' && /^\/api\/admin\/linkedin\/accounts\/[1-9]\d*$/.test(path)) ||
    (method === 'POST' && /^\/api\/admin\/linkedin\/accounts\/[1-9]\d*\/runs$/.test(path));
}
