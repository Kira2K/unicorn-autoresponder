// Explicit operator command. Never called during application startup.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPostgresPool } from '../../integrations/postgres/pg-pool.mts';
import { readPostgresAppDbConfig } from '../../platform/db/postgres/config.mts';
import { assertCopyDatabase } from '../../integrations/postgres/read-session.mts';

export async function migrateOctoOnboarding(env: NodeJS.ProcessEnv, apply: boolean) {
  const config = readPostgresAppDbConfig(env), pool = createPostgresPool(config), s = await pool.connect();
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const body = (await readFile(new URL('./sql/002-octo-onboarding.up.sql', import.meta.url), 'utf8'))
    .replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
  let committed = false;
  try {
    await s.query('BEGIN READ WRITE'); await assertCopyDatabase(s, config.database);
    await s.query('SET LOCAL ROLE unicorn_noco_copy_owner');
    // Freeze the backed-up state until verification and commit finish.
    await s.query('LOCK TABLE noco.octo_profiles,noco.dolphin_profiles,copy_meta.inventory IN SHARE ROW EXCLUSIVE MODE');
    const snapshot = async () => ({
      profiles: (await s.query('SELECT profile_id,client_id,locale,revision,state FROM noco.octo_profiles ORDER BY profile_id')).rows,
      common: (await s.query('SELECT to_jsonb(p) AS row FROM noco.dolphin_profiles p ORDER BY id')).rows,
      inventory: (await s.query('SELECT id,definition FROM copy_meta.inventory ORDER BY id')).rows
    });
    const hasClients = (await s.query("SELECT to_regclass('noco.octo_clients') AS present")).rows[0]?.present;
    if (hasClients) await s.query('LOCK TABLE noco.octo_clients IN SHARE ROW EXCLUSIVE MODE');
    const before = await snapshot();
    const clients = hasClients
      ? (await s.query('SELECT client_id,password,revision,state FROM noco.octo_clients ORDER BY client_id')).rows : [];
    if (apply) {
      const directory = resolve('storage/octo-access-backups'); await mkdir(directory,{ recursive: true });
      const path = resolve(directory,`${Date.now()}-${randomUUID()}-onboarding-before.json`);
      const text = JSON.stringify({ database: config.database, ...before, clients });
      await writeFile(path,text,{ flag:'wx', mode:0o600 });
      if (await readFile(path,'utf8') !== text) throw new Error('octo_backup_verification_failed');
    }
    await s.query(body); await s.query(body);
    if (hash(before) !== hash(await snapshot())) throw new Error('octo_existing_rows_changed');
    const counts = (await s.query('SELECT count(*)::integer AS clients FROM noco.octo_clients')).rows[0];
    await s.query(apply ? 'COMMIT' : 'ROLLBACK'); committed = apply;
    return { applied:apply, database:config.database, rerunVerified:true, existingRowsUnchanged:true, ...counts };
  } finally {
    if (!committed) await s.query('ROLLBACK').catch(() => {});
    s.release(); await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await migrateOctoOnboarding(process.env, process.argv.includes('--apply')))); }
  catch { console.error(JSON.stringify({ error:'octo_onboarding_migration_failed' })); process.exitCode=1; }
}
