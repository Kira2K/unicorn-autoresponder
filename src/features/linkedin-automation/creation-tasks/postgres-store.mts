import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { parseLinkedInResult } from '../console-intake/contracts.mts';
import { loadBlockedHistory } from './blocked-history.mts';
import { taskRow, providerStatus } from './contracts.mts';

const fail = (code: string): never => { throw new PostgresReadError(code); };
export function createCreationTaskStore(pool: SqlPool, database: CopyDatabase, linklab = false,
  afterComplete?: (taskId:number)=>Promise<unknown>) {
  const read = createReadSession(pool, database);
  async function lock(s: SqlSession, id: number, version: number, allowCompleted = false) {
    const hint = (await s.query('SELECT client_id FROM noco.linkedin_creation_task WHERE id=$1', [id])).rows[0];
    if (!hint) return fail('linkedin_task_not_found');
    // Shared lock order with the student intake, so a completion cannot race its save.
    await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)', [hint.client_id]);
    await s.query('SELECT id FROM noco.clients WHERE id=$1 FOR UPDATE', [hint.client_id]);
    const row = (await s.query(`SELECT t.* FROM noco.linkedin_creation_task t WHERE t.id=$1
      AND EXISTS(SELECT 1 FROM noco.platform_accounts a WHERE a.id=t.linkedin_account_id AND a.clients_id=t.client_id AND (NOT coalesce(a.__nc_deleted,false) OR $2::boolean AND t.status='сделана экспертом'))
      AND EXISTS(SELECT 1 FROM noco.platform_accounts a WHERE a.id=t.outlook_account_id AND a.clients_id=t.client_id AND (NOT coalesce(a.__nc_deleted,false) OR $2::boolean AND t.status='сделана экспертом'))
      FOR UPDATE OF t`, [id,allowCompleted])).rows[0];
    if (!row || row.status === 'сделана экспертом' && !allowCompleted) return fail('linkedin_task_not_found');
    if (allowCompleted && row.status === 'сделана экспертом') return taskRow(row);
    if (Number(row.version) !== version) return fail('linkedin_task_stale_version');
    return taskRow(row);
  }
  async function requireResult(s:SqlSession,task:ReturnType<typeof taskRow>) {
    const row=(await s.query('SELECT p.state FROM noco.octo_profiles p WHERE p.profile_id=$1 AND p.client_id=$2 AND p.locale=\'en\' FOR UPDATE',
      [task.proxyProfileId??null,task.clientId])).rows[0];
    const p=row?.state as any;
    if(!task.proxySavedAt||!task.proxyUuid||!p||p.proxy?.uuid!==task.proxyUuid||p.phase!=='ready'||p.deletion||p.pending||
      p.proxyChange&&p.proxyChange.phase!=='complete'||p.grant&&p.grant.phase!=='complete')return fail('linkedin_task_proxy_required');
    const li=(await s.query('SELECT url,login,password FROM noco.platform_accounts WHERE id=$1 FOR UPDATE',[task.linkedinAccountId])).rows[0];
    try{parseLinkedInResult(li);}catch{return fail('linkedin_task_result_required');}
    if(!li.password)return fail('linkedin_task_result_required');
  }
  return {
    async clientSummaries(ids:number[]) {
      if(!ids.length)return [];
      return read(async s=>(await s.query(`SELECT c.id,
        coalesce(nullif(btrim(to_jsonb(c)->>'fio'),''),btrim(c.client_name),'') AS fio,
        nullif(btrim(st.name),'') AS stack
        FROM noco.clients c LEFT JOIN noco.stacks st ON st.id=c."01_stacks_id"
        WHERE c.id=ANY($1::bigint[]) AND NOT coalesce(c.__nc_deleted,false)`,[ids])).rows.map(row=>({
          id:Number(row.id),fio:String(row.fio??''),stack:row.stack==null?undefined:String(row.stack)
        })));
    },
    async checkSchema() { await read(async s => {
      await s.query('SELECT proxy_saved_at,source,version,requires_new_proxy FROM noco.linkedin_creation_task LIMIT 0');
      await s.query('SELECT baseline_uuid FROM noco.linkedin_creation_proxy LIMIT 0');
      await s.query('SELECT recipient,chat_id,state FROM noco.linkedin_cycle_notifications LIMIT 0');
    }); },
    async list(admin = false) { return read(async s => (await s.query(`SELECT t.* FROM noco.linkedin_creation_task t WHERE ${admin?'true':"t.status<>'сделана экспертом'"}
      AND EXISTS(SELECT 1 FROM noco.platform_accounts a WHERE a.id=t.linkedin_account_id AND a.clients_id=t.client_id AND (NOT coalesce(a.__nc_deleted,false) OR $1::boolean AND t.status='сделана экспертом'))
      AND EXISTS(SELECT 1 FROM noco.platform_accounts a WHERE a.id=t.outlook_account_id AND a.clients_id=t.client_id AND (NOT coalesce(a.__nc_deleted,false) OR $1::boolean AND t.status='сделана экспертом'))
      ORDER BY t.id`,[admin])).rows.map(taskRow)); },
    async detail(id: number, admin = false) {
      return read(async s => {
        const row = (await s.query("SELECT * FROM noco.linkedin_creation_task WHERE id=$1"+(admin?'':" AND status<>'сделана экспертом'"), [id])).rows[0];
        if (!row) return fail('linkedin_task_not_found');
        const task = taskRow(row);
        const rows = (await s.query(`SELECT id,url,login,password,linkedin_first_name,linkedin_last_name,real_location,old_link_blocked,outlook_registered_at
          FROM noco.platform_accounts WHERE clients_id=$1 AND id=ANY($2::bigint[]) AND (NOT coalesce(__nc_deleted,false) OR $3::boolean)`,
        [task.clientId, [task.linkedinAccountId, task.outlookAccountId],admin&&task.status==='сделана экспертом'])).rows;
        const li = rows.find(r => Number(r.id) === task.linkedinAccountId), mail = rows.find(r => Number(r.id) === task.outlookAccountId);
        if (!li || !mail) return fail('linkedin_task_account_binding_invalid');
        return { task, intake: { url: String(li.url ?? ''), login: String(li.login ?? ''), hasPassword: !!li.password,
          outlookLogin: String(mail.login ?? ''), hasOutlookPassword: !!mail.password,
          ...(mail.outlook_registered_at?{outlookRegisteredAt:(mail.outlook_registered_at instanceof Date?mail.outlook_registered_at:new Date(String(mail.outlook_registered_at))).toISOString()}:{}),
          firstName: String(li.linkedin_first_name ?? ''), lastName: String(li.linkedin_last_name ?? ''),
          realLocation: String(li.real_location ?? ''),
          blockedAccounts: await loadBlockedHistory(s,task.clientId,task.linkedinAccountId,li.old_link_blocked) } };
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
        // Application handoff is owned by the completion trigger, never by a draft result save.
        return taskRow((await s.query('UPDATE noco.linkedin_creation_task SET updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [id])).rows[0]);
      });
    },
    async status(id: number, version: number, value: unknown) {
      const status = providerStatus(value);
      const {task,completed} = await writeTransaction(pool, database, async s => {
        const task = await lock(s, id, version, true);
        if(task.status==='сделана экспертом') {
          if(status!==task.status)return fail('linkedin_task_completed');
          return {task,completed:false};
        }
        if (task.status === status) return {task,completed:false};
        if (status === 'сделана экспертом') await requireResult(s,task);
        return {task:taskRow((await s.query('UPDATE noco.linkedin_creation_task SET status=$2 WHERE id=$1 RETURNING *', [id, status])).rows[0]),completed:status==='сделана экспертом'};
      });
      if(completed&&afterComplete)try{await afterComplete(task.id);}catch{/* Existing CRM command owner reports failures. */}
      return task;
    },
    async notification(id:number) {
      return read(async s=>{
        const rows=(await s.query('SELECT recipient,chat_id,state,message_id,error_code FROM noco.linkedin_cycle_notifications WHERE task_id=$1 ORDER BY recipient',[id])).rows;
        return {deliveries:rows.map(row=>({recipient:String(row.recipient),chatId:row.chat_id?String(row.chat_id):undefined,
          state:String(row.state),...(row.message_id?{messageId:Number(row.message_id)}:{}),...(row.error_code?{errorCode:String(row.error_code)}:{})}))};
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
