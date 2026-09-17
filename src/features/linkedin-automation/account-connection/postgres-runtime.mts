import { createRequire } from 'node:module';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../integrations/postgres/working-client.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { createSqlLinkedInStorage } from '../../web-console/backend/postgres/linkedin-repository.mts';
import type { ConsoleWrites } from '../../web-console/backend/postgres/contracts.mts';
import type { LinkedInAuthDependencies } from './types.ts';
import type { AuthLogger } from './auth-logger.ts';
const require = createRequire(import.meta.url);
const { createLinkedInAuthDependencies } = require('./runtime.ts') as {
  createLinkedInAuthDependencies(options: { apply: boolean; logger?: AuthLogger;
    repository: LinkedInAuthDependencies['repository'] }): LinkedInAuthDependencies };

export async function openSqlAuth(options: { apply: boolean; logger?: AuthLogger }, env = process.env, open = createPostgresPool) {
  const config = readPostgresAppDbConfig(env), pool = open(config);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= pool.end();
  try {
    const db = await createPostgresClient(pool, config.database, { writable: options.apply });
    const grant: ConsoleWrites | undefined = options.apply ? { clientIds: new Set(), allClients: true,
      create: (tx, table, data) => tx.createRecord(table, data) } : undefined;
    const { repository } = createSqlLinkedInStorage(db, grant);
    return { dependencies: createLinkedInAuthDependencies({ ...options, repository }), close };
  } catch (error) { await close(); throw error; }
}
