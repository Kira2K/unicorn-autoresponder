import type { SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';

/** Caller holds the client/account locks. Old secrets stay in their archived account rows. */
export async function archiveBannedAccounts(sql: SqlSession, clientId:number, linkedinId:number, outlookId?:number) {
  await sql.query('UPDATE noco.platform_accounts SET is_banned=true WHERE id=$1 AND clients_id=$2',[linkedinId,clientId]);
  // Retire the old student request before archiving: its FK/ownership trigger still sees live accounts.
  await sql.query(`UPDATE noco.linkedin_creation_task SET source='manual'
    WHERE client_id=$1 AND linkedin_account_id=$2 AND source='student_intake'`,[clientId,linkedinId]);
  const ids=outlookId?[linkedinId,outlookId]:[linkedinId];
  const result=await sql.query(`UPDATE noco.platform_accounts SET __nc_deleted=true,updated_at=statement_timestamp()
    WHERE clients_id=$1 AND id=ANY($2::bigint[]) AND NOT coalesce(__nc_deleted,false) RETURNING id`,[clientId,ids]);
  if(result.rows.length!==ids.length)throw new PostgresReadError('linkedin_intake_replacement_stale');
}
