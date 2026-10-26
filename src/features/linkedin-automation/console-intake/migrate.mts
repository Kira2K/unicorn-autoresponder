import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../../integrations/postgres/read-session.mts';
import type { CopyDatabase, SqlPool } from '../../../integrations/postgres/contracts.mts';

/** Add the nullable Outlook timestamp only; dry runs roll back and do not rewrite account data. */
export async function migrateOutlookRegistration(pool: SqlPool, database: CopyDatabase, apply = false) {
  const session = await pool.connect();
  try {
    await session.query('BEGIN READ WRITE');
    await assertCopyDatabase(session, database);
    await session.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    await session.query("SET LOCAL lock_timeout = '5s'");
    const sql = await readFile(new URL('./sql/001-outlook-registration.up.sql', import.meta.url), 'utf8');
    await session.query(sql);
    await session.query(sql);
    await session.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply, rerunVerified: true, column: 'noco.platform_accounts.outlook_registered_at' };
  } finally {
    await session.query('ROLLBACK').catch(() => {});
    session.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool: SqlPool | undefined;
  try {
    const config = readPostgresAppDbConfig(process.env);
    pool = createPostgresPool(config);
    console.log(JSON.stringify(await migrateOutlookRegistration(pool, config.database, process.argv.includes('--apply'))));
  } catch {
    console.error(JSON.stringify({ error: 'outlook_registration_migration_failed' }));
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
