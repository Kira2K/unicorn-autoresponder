import {randomUUID} from 'node:crypto';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import type {CopyDatabase, SqlPool} from '../../../integrations/postgres/contracts.mts';
import {accountCommandBody, sendAccountCommand} from './crm-account-command.mts';

export type CommandDelivery = {state: 'sent' | 'not_applicable' | 'failed' | 'uncertain'; code?: string};
type Config = {baseUrl: string; secret: string};
export function readAccountCommandConfig(env: NodeJS.ProcessEnv): Config | undefined {
  if (env.CRM_ACCOUNT_COMMANDS_ENABLED !== '1') return;
  const baseUrl = env.CRM_ACCOUNT_COMMAND_API_URL || '', secret = env.CRM_ACCOUNT_COMMAND_API_SECRET || '';
  let url: URL;
  try {url = new URL(baseUrl);} catch {throw Error('crm_account_command_configuration_required');}
  if (url.protocol !== 'https:' || url.username || url.password || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))
    throw Error('crm_account_command_configuration_required');
  return {baseUrl, secret};
}

/** Existing button actions call this only after their write transaction has committed. */
export function createAccountCommandActions(deps: {
  pool: SqlPool; database: CopyDatabase; config?: Config; fetch?: typeof globalThis.fetch;
}) {
  if (!deps.config) return undefined;
  const config = deps.config, read = createReadSession(deps.pool, deps.database);
  async function deliver(command: 'ban' | 'replacement', values: number[]): Promise<CommandDelivery> {
    try {
      // Read only identities and public URL: account credentials never leave SQL.
      const row = await read(async s => (await s.query(command === 'ban' ? `
        SELECT l.client_id,l.platform_account_id AS account_id,l.version,l.crm_student_id,a.updated_at AS confirmed_at
        FROM noco.linklab l JOIN noco.clients c ON c.id=l.client_id
        JOIN noco.platform_accounts a ON a.id=l.platform_account_id AND a.clients_id=l.client_id
        WHERE l.client_id=$1 AND a.id=$2 AND a.is_banned
          AND NOT coalesce(a.__nc_deleted,false) AND NOT coalesce(c.__nc_deleted,false)` : `
        SELECT l.client_id,l.platform_account_id AS account_id,l.version,l.crm_student_id,
          e.task_id AS cycle_id,e.old_account_id,e.applied_at AS confirmed_at,a.url AS account_url
        FROM noco.linkedin_account_cycles e JOIN noco.linklab l ON l.client_id=e.client_id AND l.platform_account_id=e.account_id
        JOIN noco.clients c ON c.id=l.client_id
        JOIN noco.platform_accounts a ON a.id=l.platform_account_id AND a.clients_id=l.client_id
        WHERE e.task_id=$1 AND e.applied_at IS NOT NULL AND NOT a.is_banned
          AND NOT coalesce(a.__nc_deleted,false) AND NOT coalesce(c.__nc_deleted,false)`, values)).rows[0]);
      if(command==='replacement'&&row&&row.old_account_id==null)return{state:'not_applicable'};
      if (!row?.crm_student_id) return {state: 'failed', code: 'crm_account_not_linked_or_current'};
      const common = {event_id: randomUUID(), client_id: String(row.client_id), account_id: String(row.account_id),
        linklab_version: String(row.version), confirmed_at: (row.confirmed_at instanceof Date
          ?row.confirmed_at:new Date(String(row.confirmed_at))).toISOString()};
      const body = accountCommandBody(command === 'ban' ? {command, ...common} : {command, ...common,
        cycle_id: String(row.cycle_id), old_account_id: String(row.old_account_id),
        account_url: profileUrl(String(row.account_url))});
      // createReadSession has already rolled back/released before the external request.
      await sendAccountCommand({body, expectedStudentId: String(row.crm_student_id)}, {...config, fetch: deps.fetch});
      return {state: 'sent'};
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^crm_account_command_[a-z0-9_]+$/.test(message) ? message : 'crm_account_command_unconfirmed';
      const refused = /^crm_account_command_http_4\d\d$/.test(code) || /_(payload|endpoint|secret|timestamp)_invalid$/.test(code);
      return {state: refused ? 'failed' : 'uncertain', code};
    }
  }
  return {
    ban: (clientId: number, accountId: number) => deliver('ban', [clientId, accountId]),
    replacement: (taskId: number) => deliver('replacement', [taskId]),
  };
}

function profileUrl(value:string):string{
  const url=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);
  if(!/^(www\.)?linkedin\.com$/i.test(url.hostname)||url.username||url.password)throw Error('crm_account_command_payload_invalid');
  const slug=url.pathname.split('/')[2];
  if(!/^\/in\/[^/]+\/?$/i.test(url.pathname)||!slug)throw Error('crm_account_command_payload_invalid');
  let decoded=slug;try{decoded=decodeURIComponent(slug);}catch{/* Preserve a literal percent in legacy input. */}
  return 'https://www.linkedin.com/in/'+encodeURIComponent(decoded).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
}
