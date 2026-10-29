import { randomUUID } from 'node:crypto';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../../integrations/postgres/working-session.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts';
import { assignGeneratedId, generatedIdColumn } from '../../../integrations/postgres/generated-ids.mts';
import { encodeKey } from '../../../integrations/postgres/records.mts';
import type { CopyDatabase, SqlPool, SqlSession } from '../../../integrations/postgres/contracts.mts';
import { claimClientPassword, saveClientState } from '../../octo-access/postgres-clients.mts';
import { generateProfilePassword } from '../../octo-access/password.mts';
import { syncLinkLabAccount } from '../linklab/intake.mts';
import { readBlockedAccounts } from './contracts.mts';
import type { LinkedInIntake, LinkedInIntakeView } from './contracts.mts';
import { tableIds } from '../../web-console/backend/postgres/tables.mts';
import { assertStudentEditable, readStudentTask, readAccountTask, saveStudentTask, studentAccountAccess } from '../creation-tasks/student-task.mts';
import { previousProfileAccess } from './previous-profile-access.mts';
import { archiveBannedAccounts } from './archive-banned-accounts.mts';
import {blockedHistoryCard,loadBlockedHistory} from '../creation-tasks/blocked-history.mts';
import type { Locale } from '../../octo-access/contracts.mts';

const accountQuery = `SELECT a.id,a.platforms_id,a.url,a.login,a.password,a.linkedin_first_name,
  a.linkedin_last_name,a.real_location,a.old_link_blocked,a.outlook_registered_at,to_jsonb(a)->'is_banned' AS is_banned,a.linkedin_octo_connection_pending,lower(p.name) AS platform
  FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
  WHERE a.clients_id=$1 AND lower(p.name) IN ('linkedin','email_outlook')
  AND NOT COALESCE(a.__nc_deleted,false) AND NOT COALESCE(p.__nc_deleted,false) ORDER BY a.id`;
function select(rows: Record<string, unknown>[], platform: string):Record<string,unknown>|undefined {
  const candidates = rows.filter(r => r.platform === platform);
  if (candidates.length > 1) throw new PostgresReadError('linkedin_intake_account_ambiguous');
  return candidates[0];
}
const timestamp = (value: unknown) => value == null ? '' :
  (value instanceof Date ? value : new Date(String(value))).toISOString();
async function lockBanAccount(s:SqlSession,clientId:number,expectedAccountId:number) {
  await s.query('SELECT pg_advisory_xact_lock(730644,$1::integer)',[clientId]);
  if(!(await s.query('SELECT id FROM noco.clients WHERE id=$1 AND NOT coalesce(__nc_deleted,false) FOR UPDATE',[clientId])).rows.length)throw new PostgresReadError('record_not_found');
  const rows=(await s.query(accountQuery+' FOR UPDATE OF a',[clientId])).rows,li=select(rows,'linkedin');
  if(!li||Number(li.id)!==expectedAccountId||!(li.url||li.login||li.password))throw new PostgresReadError('linkedin_intake_replacement_stale');
  if((await studentAccountAccess(s,clientId,expectedAccountId)).registrationPending)throw new PostgresReadError('linkedin_intake_registration_pending');
  return li;
}
export function createLinkedInIntakeStore(pool: SqlPool, database: CopyDatabase, linklab = false, creationTasks = false,
  afterBan?: (clientId:number,accountId:number)=>Promise<unknown>) {
  const read = createReadSession(pool, database);
  return {
    async checkSchema() { await read(async s => { await s.query(accountQuery + ' LIMIT 0', [0]);await s.query('SELECT is_banned FROM noco.platform_accounts LIMIT 0');await s.query('SELECT account_id,state FROM noco.linkedin_intake_notifications LIMIT 0'); }); },
    async load(clientId: number):Promise<LinkedInIntakeView> {
      return read(async s => {
        const rows = (await s.query(accountQuery, [clientId])).rows;
        const li = select(rows, 'linkedin'), email = select(rows, 'email_outlook');
        // No secret is returned; leaving a password blank preserves its current value.
        const task = creationTasks && li ? await readAccountTask(s, clientId,Number(li.id)) : undefined;
        const editableBlockedAccounts=readBlockedAccounts(li?.old_link_blocked);
        const blockedAccounts=li?await loadBlockedHistory(s,clientId,Number(li.id),li.old_link_blocked):editableBlockedAccounts;
        const reported=li?.is_banned===true?blockedHistoryCard({...li,has_password:!!li.password},false):undefined;
        if(reported)blockedAccounts.push(reported);
        const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
        const archivedBlockedAccounts=blockedAccounts.filter(card=>!editableBlockedAccounts.some(entered=>same(card,entered)));
        const confirmedAt=task?.status==='выполнение подтверждено'?(await s.query('SELECT applied_at FROM noco.linkedin_account_cycles WHERE task_id=$1',[task.id])).rows[0]?.applied_at:undefined;
        return { ...(creationTasks ? { task, ...await studentAccountAccess(s,clientId,li?Number(li.id):undefined),
          ...await previousProfileAccess(s,clientId,task) } : {}),
          linkedinAccountId:li?Number(li.id):undefined,hasLinkedIn:!!li&&(!!li.url||!!li.login||!!li.password),
          octoConnectionPending:li?.linkedin_octo_connection_pending===true,
          outlookAccountId:email?Number(email.id):undefined,isBanned:li?.is_banned===true,
          ...(confirmedAt?{warmupUntil:new Date(new Date(String(confirmedAt)).getTime()+30*86400000).toISOString()}:{}),
          url: String(li?.url ?? ''), login: String(li?.login ?? ''), hasPassword: !!li?.password,
          outlookLogin: String(email?.login ?? ''), hasOutlookPassword: !!email?.password,
          ...(email?.outlook_registered_at ? { outlookRegisteredAt: timestamp(email.outlook_registered_at) } : {}),
          firstName: String(li?.linkedin_first_name ?? ''), lastName: String(li?.linkedin_last_name ?? ''),
          realLocation: String(li?.real_location ?? ''), blockedAccounts,editableBlockedAccounts,archivedBlockedAccounts };
      });
    },
    async reportBan(clientId:number,expectedAccountId:number){
      const {result,changed}=await writeTransaction(pool,database,async s=>{
        const li=await lockBanAccount(s,clientId,expectedAccountId);
        let banUndoVersion:string|undefined;
        if(li.is_banned!==true){const result=await s.query('UPDATE noco.platform_accounts SET is_banned=true,updated_at=statement_timestamp() WHERE id=$1 AND clients_id=$2 RETURNING id,xmin::text AS ban_version',[expectedAccountId,clientId]);
          if(result.rows.length!==1)throw new PostgresReadError('linkedin_intake_replacement_stale');
          banUndoVersion=String(result.rows[0].ban_version);}
        return{result:{reported:true,linkedinAccountId:expectedAccountId,isBanned:true,...(banUndoVersion?{banUndoVersion}:{})},changed:banUndoVersion!==undefined};
      });
      // Preserve master: CRM observes the committed ban, never an in-transaction notification.
      if(changed&&afterBan)try{await afterBan(clientId,expectedAccountId);}catch{/* Delivery owner reports failures. */}
      return result;
    },
    async cancelBan(clientId:number,expectedAccountId:number,banUndoVersion:string){
      return writeTransaction(pool,database,async s=>{
        const li=await lockBanAccount(s,clientId,expectedAccountId);
        if(li.is_banned===true){
          const result=await s.query(`UPDATE noco.platform_accounts SET is_banned=false,updated_at=statement_timestamp()
            WHERE id=$1 AND clients_id=$2 AND is_banned=true AND xmin::text=$3 RETURNING id`,[expectedAccountId,clientId,banUndoVersion]);
          if(result.rows.length!==1)throw new PostgresReadError('linkedin_intake_ban_changed');
        }
        return{cancelled:true,linkedinAccountId:expectedAccountId,isBanned:false};
      });
    },
    async save(clientId: number, data: LinkedInIntake, locales: string[], options = { createOctoProfiles: true }) {
      return writeTransaction(pool, database, async s => {
        // Use the same order as Octo reservation, then lock the student for all account saves.
        await s.query('SELECT pg_advisory_xact_lock(730644, $1::integer)', [clientId]);
        const client = (await s.query('SELECT id FROM noco.clients WHERE id=$1 AND NOT COALESCE(__nc_deleted,false) FOR UPDATE', [clientId])).rows[0];
        if (!client) throw new PostgresReadError('record_not_found');
        const replacement = data.replacesLinkedInAccountId !== undefined;
        const rows = (await s.query(accountQuery + ' FOR UPDATE OF a', [clientId])).rows;
        let li = select(rows, 'linkedin'), email = select(rows, 'email_outlook');
        const current=creationTasks&&li?await readAccountTask(s,clientId,Number(li.id)):undefined;
        const editingTask=!replacement&&current&&Number(li?.id)===current.linkedinAccountId&&Number(email?.id)===current.outlookAccountId?current:undefined;
        if(!replacement&&current&&!editingTask)throw new PostgresReadError('linkedin_task_account_binding_invalid');
        if (creationTasks && !replacement && (await s.query('SELECT id FROM noco.dolphin_profiles WHERE "02_clients_id"=$1 AND browser=\'dolphin\' AND NOT coalesce(__nc_deleted,false) LIMIT 1', [clientId])).rows.length) {
          if(data.scenario!=='new'||!editingTask)
            throw new PostgresReadError('linkedin_intake_use_dolphin');
        }
        if (replacement) {
          if (!creationTasks || !li || Number(li.id)!==data.replacesLinkedInAccountId || !(li.url||li.login||li.password))
            throw new PostgresReadError('linkedin_intake_replacement_stale');
          const previous=await readStudentTask(s,clientId);
          if(previous&&previous.linkedinAccountId!==Number(li.id))throw new PostgresReadError('linkedin_intake_replacement_stale');
          if((await studentAccountAccess(s,clientId,Number(li.id))).registrationPending)
            throw new PostgresReadError('linkedin_intake_registration_pending');
          if (!data.outlookPassword) throw new PostgresReadError('linkedin_intake_outlook_password_required');
          await archiveBannedAccounts(s,clientId,Number(li.id),email?Number(email.id):undefined);
          li=undefined;email=undefined;
        } else if (creationTasks) {
          for(const row of [li,email])if(row)await assertStudentEditable(s,clientId,Number(row.id));
        }
        if(editingTask&&data.scenario!=='new')throw new PostgresReadError('linkedin_intake_registration_pending');
        if (data.scenario === 'new' && !editingTask && [li?.url,li?.login,li?.password].some(value=>String(value??'').trim())) throw new PostgresReadError('linkedin_intake_existing_account');
        if (data.scenario === 'existing' && !data.password && !li?.password)
          throw new PostgresReadError('linkedin_intake_password_required');
        if (data.scenario === 'new' && !data.outlookPassword && !email?.password)
          throw new PostgresReadError('linkedin_intake_outlook_password_required');
        const upsert = async (platform: string, previous: Record<string, unknown> | undefined, patch: Record<string, unknown>) => {
          const keys = Object.keys(patch), values = Object.values(patch);
          if (previous) {
            await s.query(`UPDATE noco.platform_accounts SET ${keys.map((key, i) => `${key}=$${i + 3}`).join(',')}
              WHERE id=$1 AND clients_id=$2`, [previous.id, clientId, ...values]);
            return Number(previous.id);
          }
          const platforms = (await s.query('SELECT id FROM noco.platforms WHERE lower(name)=$1 AND NOT COALESCE(__nc_deleted,false)', [platform])).rows;
          if (platforms.length !== 1) throw new PostgresReadError('linkedin_intake_platform_required');
          const catalog = createWorkingCatalog((await s.query(
            "SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows);
          const table = catalog.get(tableIds.accounts), identity: Record<string, unknown> = {};
          await assignGeneratedId(s, table, identity);
          const id = String(identity[generatedIdColumn(table).dataKey]);
          const source = JSON.stringify({ Id: Number(id), clients_id: clientId, platforms_id: Number(platforms[0].id), ...patch });
          const saved = await s.query(`INSERT INTO noco.platform_accounts(id,_copy_id,_copy_source,clients_id,platforms_id,${keys.join(',')},created_at,updated_at)
            VALUES($1,$2,$3::jsonb,$4,$5,${keys.map((_, i) => '$' + (i + 6)).join(',')},statement_timestamp(),statement_timestamp()) RETURNING id`,
          [id, encodeKey(table, [id]), source, clientId, platforms[0].id, ...values]);
          return Number(saved.rows[0].id);
        };
        let linkedinAccountId: number, outlookAccountId: number | undefined;
        if (data.scenario === 'existing') {
          if(li?.is_banned===true)throw new PostgresReadError('linkedin_intake_banned_account');
          const profiles = (await s.query('SELECT locale,state FROM noco.octo_profiles WHERE client_id=$1 FOR SHARE', [clientId])).rows;
          if (data.stage!=='credentials'&&(!locales.every(locale => profiles.some(p => p.locale === locale &&
            (p.state as { phase?: string; deletion?: unknown }).phase === 'ready' && !(p.state as { deletion?: unknown }).deletion)) ||
            !profiles.some(p => p.locale === 'en' && (p.state as { proxy?: unknown }).proxy &&
              (!((p.state as { proxyChange?: { phase: string } }).proxyChange) ||
                (p.state as { proxyChange?: { phase: string } }).proxyChange?.phase === 'complete'))))
            throw new PostgresReadError('linkedin_intake_infrastructure_required');
          if(data.stage!=='credentials'&&li?.linkedin_octo_connection_pending===true){
            const setup=(await s.query("SELECT state->'setup' AS setup FROM noco.octo_clients WHERE client_id=$1 FOR SHARE",[clientId])).rows[0]?.setup as {phase?:string}|undefined;
            if(setup&&setup.phase!=='complete')throw new PostgresReadError('linkedin_intake_infrastructure_required');
          }
          linkedinAccountId = await upsert('linkedin', li, { url: data.url, login: data.login,
            linkedin_octo_connection_pending:data.stage==='credentials',
            ...(data.password ? { password: data.password } : {}) });
          if (linklab&&data.stage!=='credentials') await syncLinkLabAccount(s, clientId);
          const changed=!li||String(li.url??'')!==data.url||String(li.login??'')!==data.login||!!data.password&&data.password!==li.password;
          if(data.stage!=='credentials'&&(changed||li?.linkedin_octo_connection_pending===true))await s.query('INSERT INTO noco.linkedin_intake_notifications(account_id,client_id) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING',[linkedinAccountId,clientId]);
        } else {
          linkedinAccountId = await upsert('linkedin', li, { linkedin_first_name: data.firstName,
            linkedin_last_name: data.lastName, real_location: data.realLocation, old_link_blocked: JSON.stringify(data.blockedAccounts) });
          outlookAccountId = await upsert('email_outlook', email, { login: data.outlookLogin,
            ...(data.outlookRegisteredAt ? { outlook_registered_at: data.outlookRegisteredAt } : {}),
            ...(data.outlookPassword ? { password: data.outlookPassword } : {}) });
          if (options.createOctoProfiles && !editingTask) await queueDirectProfiles(s, clientId, locales, replacement);
        }
        const task = creationTasks && outlookAccountId ? await saveStudentTask(s, clientId, linkedinAccountId, outlookAccountId,
          !li || !email || String(li.linkedin_first_name ?? '') !== data.firstName ||
          String(li.linkedin_last_name ?? '') !== data.lastName || String(li.real_location ?? '') !== data.realLocation ||
          String(li.old_link_blocked ?? '') !== JSON.stringify(data.blockedAccounts) || String(email.login ?? '') !== data.outlookLogin ||
          !!data.outlookRegisteredAt && timestamp(email.outlook_registered_at) !== data.outlookRegisteredAt ||
          !!data.outlookPassword && data.outlookPassword !== email.password,editingTask?.id) : undefined;
        return { saved: true, ...(task ? { task } : {}), linkedinAccountId, ...(outlookAccountId ? { outlookAccountId } : {}) };
      });
    }
  };
}
async function queueDirectProfiles(s: SqlSession, clientId: number, locales: string[], confirmDolphin = false) {
  const state = await claimClientPassword(s, clientId, generateProfilePassword());
  const profiles = (await s.query('SELECT locale,state FROM noco.octo_profiles WHERE client_id=$1', [clientId])).rows;
  if (profiles.some(p => (p.state as { deletion?: unknown })?.deletion)) throw new PostgresReadError('octo_profile_deleting');
  if (locales.every(locale => profiles.some(p => p.locale === locale))) return;
  if (state.setup?.phase === 'unknown') throw new PostgresReadError('octo_setup_outcome_unknown');
  if (state.setup && !['complete','blocked'].includes(state.setup.phase)) {
    if (state.setup.source === 'direct') {
      const needed=locales as Locale[];
      if (needed.some(locale=>!state.setup!.locales?.includes(locale)) || confirmDolphin&&!state.setup.confirmDolphin) {
        state.setup.locales=[...new Set([...(state.setup.locales??[]),...needed])];
        state.setup.confirmDolphin ||= confirmDolphin;await saveClientState(s,state);
      }
      return;
    }
    throw new PostgresReadError('octo_setup_busy');
  }
  state.setup = { id: randomUUID(), source: 'direct', phase: 'provisioning', createdAt: Date.now(), confirmDolphin,locales:locales as Locale[] };
  await saveClientState(s, state);
}
