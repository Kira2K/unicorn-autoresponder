import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../../integrations/postgres/contracts.mts';

/** Transaction-local source marker; the INSERT trigger owns the LinkedIn-only rule. */
export async function markConsoleAccountCreation(session:SqlSession) {
  await session.query("SELECT set_config('unicorn.console_account_creation','1',true)");
}

export function linkedInCrmSyncStore(pool:SqlPool,database:CopyDatabase) {
  const read=createReadSession(pool,database);
  return {
    async checkSchema() { await read(async s=>{
      await s.query('SELECT "isUnsyncedWithCRM" FROM noco.platform_accounts LIMIT 0');
      const ready=(await s.query(`SELECT EXISTS(SELECT 1 FROM pg_trigger
        WHERE tgrelid='noco.platform_accounts'::regclass AND tgname='linkedin_console_crm_unsynced'
          AND tgenabled IN ('O','A') AND NOT tgisinternal) AS ready`)).rows[0]?.ready;
      if(!ready)throw new PostgresReadError('linkedin_crm_sync_schema_required');
    }); },
    async readFlags(ids:number[]):Promise<Array<{id:number;isUnsyncedWithCRM:boolean}>> {
      if(!ids.length)return [];
      return read(async s=>(await s.query(`SELECT a.id,a."isUnsyncedWithCRM" FROM noco.platform_accounts a
        JOIN noco.platforms p ON p.id=a.platforms_id WHERE a.id=ANY($1::bigint[]) AND lower(p.name)='linkedin'`,[ids])).rows
        .map(row=>({id:Number(row.id),isUnsyncedWithCRM:row.isUnsyncedWithCRM===true})));
    }
  };
}
