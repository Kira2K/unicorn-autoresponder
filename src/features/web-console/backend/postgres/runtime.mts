import { createPostgresPool } from '../../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../../integrations/postgres/working-client.mts';
import type { PostgresTransaction } from '../../../../integrations/postgres/working-client.mts';
import { assertGeneratedIds } from '../../../../integrations/postgres/identity-preflight.mts';
import { readPostgresAppDbConfig } from '../../../../platform/db/postgres/config.mts';
import { sqlAppOptions } from './app-options.mts';
import { runtimeCreateTables } from './runtime-tables.mts';
import { createAutomationSqlStore } from '../../../../integrations/postgres/linkedin-automation/store.mts';
import { acquireLinkedInAuthority } from '../../../../integrations/postgres/linkedin-automation/authority.mts';
import { automationError } from '../../../linkedin-automation/orchestrator/contracts.ts';

export async function openSqlConsole(env: NodeJS.ProcessEnv, open = createPostgresPool) {
  const config = readPostgresAppDbConfig(env), pool = open(config);
  let authorityPool: ReturnType<typeof open> | undefined;
  let closing: Promise<void> | undefined;
  let releaseAuthority: (()=>Promise<void>) | undefined;
  const close = () => closing ??= (async()=>{
    try { await releaseAuthority?.(); }
    finally { await Promise.all([...new Set([pool, authorityPool].filter(Boolean))].map(p=>p!.end())); }
  })();
  try {
    const db = await createPostgresClient(pool, config.database, { writable: true });
    await assertGeneratedIds(pool, config.database, runtimeCreateTables(db));
    const create = (tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>) => tx.createRecord(table, data);
    const options = sqlAppOptions(db, { clientIds: new Set(), allClients: true, create },
      { accountIds: new Set(), allAccounts: true, create });
    try {
      // Every SQL console participates, even when the new calendar is disabled.
      // Otherwise a legacy/manual backend could bypass the database-wide writer lock.
      let leader=true;
      let authority: import('../../../linkedin-automation/orchestrator/contracts.ts').ExecutionAuthority;
      // A session lock is held for the backend's entire lifetime. Keep it out of the
      // two-connection data pool so UI reads, transactions and audit can run together.
      authorityPool = open(config);
      try {const acquired=await acquireLinkedInAuthority(authorityPool,config.database);authority=acquired;releaseAuthority=acquired.close;}
      catch(error) {
        if((error as any)?.code !== 'automation_writer_active') throw error;
        leader=false;
        const refuse=()=>{throw automationError('automation_writer_active')};
        authority={assertOwned:refuse,check:async()=>refuse()};
      }
      options.linkedinStorage.executionControl={authority,leader};
      const storage=createAutomationSqlStore(pool,config.database);
      if(env.LINKEDIN_ORCHESTRATOR_ENABLED === 'true' || await storage.exists()) {
        await storage.checkSchema();
        options.linkedinStorage.automation={...storage,authority,leader,
          // Removing the flag must not restore legacy schedules or lose the SQL withdrawal journal.
          previewOnly:env.LINKEDIN_ORCHESTRATOR_ENABLED !== 'true' || env.LINKEDIN_ORCHESTRATOR_PREVIEW_ONLY !== 'false'};
      }
    } catch (error) {
      // LinkedIn preflight is not a prerequisite for the rest of the console.
      // Keep the authority explicitly closed: omitting it would enable legacy writers.
      const known = new Set(['automation_schema_required','automation_withdrawal_import_required',
        'automation_writer_unavailable','postgres_read_unavailable','postgres_read_failed','database_not_allowed']);
      const cause = (error as {code?:string})?.code;
      const code = cause && known.has(cause) ? cause : 'automation_startup_failed';
      const refuse = () => {throw automationError(code)};
      options.linkedinStorage.executionControl={leader:false,authority:{assertOwned:refuse,check:async()=>refuse()}};
      options.linkedinStorage.automationUnavailable=code;
      const release=releaseAuthority;releaseAuthority=undefined;
      try {await release?.();} catch {console.warn('[linkedin-automation] automation_writer_release_failed');}
      console.warn(`[linkedin-automation] startup disabled: ${code}`);
    }
    return { options, close };
  } catch (error) { await close(); throw error; }
}
