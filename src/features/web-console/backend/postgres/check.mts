import { createPostgresPool } from '../../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../../integrations/postgres/working-client.mts';
import { assertGeneratedIds } from '../../../../integrations/postgres/identity-preflight.mts';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { readPostgresAppDbConfig } from '../../../../platform/db/postgres/config.mts';
import { runtimeCreateTables } from './runtime-tables.mts';
import { cvLocalColumns } from './workflow-fields.mts';
import { tableIds } from './tables.mts';

// Check the existing database only. No app, provider, migration or background job is created.
export async function checkSqlStorage(env: NodeJS.ProcessEnv, open = createPostgresPool) {
  if (env.APP_DB !== 'postgres') throw new PostgresReadError('sql_check_requires_postgres');
  const config = readPostgresAppDbConfig(env), pool = open(config);
  try {
    const db = await createPostgresClient(pool, config.database), tables = db.listTables();
    const cv = tables.find(t => t.id === tableIds.cv);
    if (!cv || cvLocalColumns.some(name => !cv.columns.some(c => c.dataKey === name && c.sqlType === 'text')))
      throw new PostgresReadError('sql_check_cv_columns_required');
    const creating = runtimeCreateTables(db);
    await assertGeneratedIds(pool, config.database, creating);
    for (const table of tables) await db.listRecords(table.id, { limit: 1 });
    return { database: config.database, tables: tables.length, idTables: creating.length,
      writes: false, backgroundJobs: false, externalActions: false };
  } finally { await pool.end(); }
}
