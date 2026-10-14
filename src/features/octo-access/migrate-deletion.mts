// Explicit permission-only migration; never imported by backend startup.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../integrations/postgres/read-session.mts';

export async function migrateOctoDeletion(env: NodeJS.ProcessEnv, apply: boolean) {
  const config = readPostgresAppDbConfig(env), pool = createPostgresPool(config), s = await pool.connect();
  const body = (await readFile(new URL('./sql/003-octo-deletion.up.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\r?$/m, '').replace(/^COMMIT;\r?$/m, '');
  let committed = false;
  try {
    await s.query('BEGIN READ WRITE'); await assertCopyDatabase(s, config.database);
    await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    await s.query(body); await s.query(body);
    const rights = (await s.query(`SELECT
      has_table_privilege('unicorn_sql_app','noco.octo_profiles','DELETE') AND
      has_table_privilege('unicorn_sql_app','noco.octo_event_inbox','DELETE') AND
      has_table_privilege('unicorn_sql_app','noco.dolphin_profiles','DELETE') AS ready`)).rows[0]?.ready;
    if (rights !== true) throw new Error('octo_deletion_permissions_missing');
    await s.query(apply ? 'COMMIT' : 'ROLLBACK'); committed = apply;
    return { applied: apply, database: config.database, rerunVerified: true, permissionsVerified: true };
  } finally {
    if (!committed) await s.query('ROLLBACK').catch(() => {});
    s.release(); await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await migrateOctoDeletion(process.env, process.argv.includes('--apply')))); }
  catch { console.error(JSON.stringify({ error: 'octo_deletion_migration_failed' })); process.exitCode = 1; }
}
