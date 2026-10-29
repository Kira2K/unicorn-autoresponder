import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../../integrations/postgres/read-session.mts';
import type { CopyDatabase, SqlPool } from '../../../integrations/postgres/contracts.mts';

/** Explicit column migrations: dry runs roll back; no startup DDL or historical handoffs. */
async function migrateColumn(pool: SqlPool, database: CopyDatabase, apply:boolean, file:string,column:string) {
  const session = await pool.connect();
  try {
    await session.query('BEGIN READ WRITE');
    await assertCopyDatabase(session, database);
    await session.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    await session.query("SET LOCAL lock_timeout = '5s'");
    const sql = await readFile(new URL(file, import.meta.url), 'utf8');
    await session.query(sql);
    await session.query(sql);
    await session.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, rerunVerified: true, column };
  } finally {
    await session.query('ROLLBACK').catch(() => {});
    session.release();
  }
}
export const migrateOutlookRegistration=(pool:SqlPool,database:CopyDatabase,apply=false)=>migrateColumn(pool,database,apply,'./sql/001-outlook-registration.up.sql','noco.platform_accounts.outlook_registered_at');
export const migrateExistingConnection=(pool:SqlPool,database:CopyDatabase,apply=false)=>migrateColumn(pool,database,apply,'./sql/002-existing-connection.up.sql','noco.platform_accounts.linkedin_octo_connection_pending');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool: SqlPool | undefined;
  try {
    const config = readPostgresAppDbConfig(process.env);
    pool = createPostgresPool(config);
    const migrate=process.argv.includes('--existing-connection')?migrateExistingConnection:migrateOutlookRegistration;
    console.log(JSON.stringify(await migrate(pool, config.database, process.argv.includes('--apply'))));
  } catch {
    console.error(JSON.stringify({ error: 'outlook_registration_migration_failed' }));
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
