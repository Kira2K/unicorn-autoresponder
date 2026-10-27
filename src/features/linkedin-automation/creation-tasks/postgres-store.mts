import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { parseLinkedInResult, readBlockedAccounts } from '../console-intake/contracts.mts';
import { syncLinkLabAccount } from '../linklab/intake.mts';
import { taskRow, providerStatus } from './contracts.mts';

const fail = (code: string): never => { throw new PostgresReadError(code); };
export function createCreationTaskStore(pool: SqlPool, database: CopyDatabase, linklab = false) {
  const read = createReadSession(pool, database);
  async function lock(s: SqlSession, id: number, version: number) {
    const hint = (await s.query('SELECT client_id FROM noco.linkedin_creation_task WHERE id=$1', [id])).rows[0];
    if (!hint) return fail('linkedin_task_not_found');
    // Shared lock order with the student intake, so a completion cannot race its save.
    await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)', [hint.client_id]);
    await s.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE', [hint.client_id]);
    const row = (await s.query('SELECT * FROM noco.linkedin_creation_task WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.status === 'выполнение подтверждено') return fail('linkedin_task_not_found');
    if (Number(row.version) !== version) return fail('linkedin_task_stale_version');
    return taskRow(row);
  }
  return {
    async checkSchema() { await read(s => s.query('SELECT proxy_saved_at,source,version FROM noco.linkedin_creation_task LIMIT 0')); },
    async list() { return read(async s => (await s.query("SELECT * FROM noco.linkedin_creation_task WHERE status<>'выполнение подтверждено' ORDER BY id")).rows.map(taskRow)); },
    async detail(id: number) {
      return read(async s => {
        const row = (await s.query("SELECT * FROM noco.linkedin_creation_task WHERE id=$1 AND status<>'выполнение подтверждено'", [id])).rows[0];
        if (!row) return fail('linkedin_task_not_found');
        const task = taskRow(row);
        const rows = (await s.query(`SELECT id,url,login,password,linkedin_first_name,linkedin_last_name,real_location,old_link_blocked
          FROM noco.platform_accounts WHERE clients_id=$1 AND id=ANY($2::bigint[]) AND NOT coalesce(__nc_deleted,false)`,
        [task.clientId, [task.linkedinAccountId, task.outlookAccountId]])).rows;
        const li = rows.find(r => Number(r.id) === task.linkedinAccountId), mail = rows.find(r => Number(r.id) === task.outlookAccountId);
        if (!li || !mail) return fail('linkedin_task_account_binding_invalid');
        return { task, intake: { url: String(li.url ?? ''), login: String(li.login ?? ''), hasPassword: !!li.password,
          outlookLogin: String(mail.login ?? ''), hasOutlookPassword: !!mail.password,
          firstName: String(li.linkedin_first_name ?? ''), lastName: String(li.linkedin_last_name ?? ''),
          realLocation: String(li.real_location ?? ''), blockedAccounts: readBlockedAccounts(li.old_link_blocked) } };
      });
    },
    async result(id: number, version: number, raw: Record<string, unknown>) {
      const data = parseLinkedInResult(raw);
      return writeTransaction(pool, database, async s => {
        const task = await lock(s, id, version);
        const previous = (await s.query('SELECT password FROM noco.platform_accounts WHERE id=$1 FOR UPDATE', [task.linkedinAccountId])).rows[0];
        if (!data.password && !previous?.password) return fail('linkedin_intake_password_required');
        await s.query(`UPDATE noco.platform_accounts SET url=$2,login=$3,password=CASE WHEN $4='' THEN password ELSE $4 END,
          updated_at=statement_timestamp() WHERE id=$1`, [task.linkedinAccountId, data.url, data.login, data.password]);
        if (linklab) await syncLinkLabAccount(s, task.clientId);
        return taskRow((await s.query('UPDATE noco.linkedin_creation_task SET updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [id])).rows[0]);
      });
    },
    async status(id: number, version: number, value: unknown) {
      const status = providerStatus(value);
      return writeTransaction(pool, database, async s => {
        const task = await lock(s, id, version);
        if (task.status === status) return task;
        if (status === 'сделана экспертом') {
          const row = (await s.query(`SELECT p.state FROM noco.octo_profiles p WHERE p.profile_id=$1 AND p.client_id=$2 AND p.locale='en' FOR UPDATE`,
          [task.proxyProfileId ?? null, task.clientId])).rows[0];
          const p = row?.state as any;
          if (!task.proxySavedAt || !task.proxyUuid || !p || p.proxy?.uuid !== task.proxyUuid || p.phase !== 'ready' || p.deletion ||
              p.pending || p.proxyChange && p.proxyChange.phase !== 'complete' || p.grant && p.grant.phase !== 'complete')
            return fail('linkedin_task_proxy_required');
          const li = (await s.query('SELECT url,login,password FROM noco.platform_accounts WHERE id=$1 FOR UPDATE', [task.linkedinAccountId])).rows[0];
          try { parseLinkedInResult(li); } catch { return fail('linkedin_task_result_required'); }
          if (!li.password) return fail('linkedin_task_result_required');
        }
        return taskRow((await s.query('UPDATE noco.linkedin_creation_task SET status=$2 WHERE id=$1 RETURNING *', [id, status])).rows[0]);
      });
    },
    async receipt(id: number, version: number, profileId: number, proxyUuid: string, revision: number) {
      return writeTransaction(pool, database, async s => {
        const task = await lock(s, id, version);
        const p = (await s.query("SELECT state,revision FROM noco.octo_profiles WHERE profile_id=$1 AND client_id=$2 AND locale='en' FOR UPDATE", [profileId,task.clientId])).rows[0];
        const state = p?.state as any;
        if (!p || Number(p.revision) !== revision || state.proxy?.uuid !== proxyUuid || state.phase !== 'ready' || state.deletion || state.pending ||
          state.grant && state.grant.phase !== 'complete' || state.proxyChange && state.proxyChange.phase !== 'complete') return fail('linkedin_task_proxy_changed');
        return taskRow((await s.query(`UPDATE noco.linkedin_creation_task SET proxy_profile_id=$2,proxy_uuid=$3,proxy_saved_at=clock_timestamp()
          WHERE id=$1 RETURNING *`, [id,profileId,proxyUuid])).rows[0]);
      });
    }
  };
}
export type CreationTaskStore = ReturnType<typeof createCreationTaskStore>;
