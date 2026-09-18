import { createPostgresPool } from '../../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../../integrations/postgres/working-client.mts';
import type { PostgresTransaction } from '../../../../integrations/postgres/working-client.mts';
import { assertGeneratedIds } from '../../../../integrations/postgres/identity-preflight.mts';
import { readPostgresAppDbConfig } from '../../../../platform/db/postgres/config.mts';
import { sqlAppOptions } from './app-options.mts';
import { runtimeCreateTables } from './runtime-tables.mts';

export async function openSqlConsole(env: NodeJS.ProcessEnv, open = createPostgresPool) {
  const config = readPostgresAppDbConfig(env), pool = open(config);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= pool.end();
  try {
    const db = await createPostgresClient(pool, config.database, { writable: true });
    await assertGeneratedIds(pool, config.database, runtimeCreateTables(db));
    const create = (tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>) => tx.createRecord(table, data);
    const options = sqlAppOptions(db, { clientIds: new Set(), allClients: true, create },
      { accountIds: new Set(), allAccounts: true, create });
    return { options, close };
  } catch (error) { await close(); throw error; }
}
