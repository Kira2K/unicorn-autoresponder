import {randomUUID} from 'node:crypto';
import {createReadSession} from '../../../integrations/postgres/read-session.mts';
import type {CopyDatabase, SqlPool} from '../../../integrations/postgres/contracts.mts';
import {accountCommandBody, sendAccountCommand} from './crm-account-command.mts';

export type CommandDelivery = {state: 'sent' | 'queued' | 'not_applicable' | 'failed' | 'uncertain'; code?: string; eventId?:string};
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
  report?(event:CommandDelivery&{command:'ban'|'replacement';clientId?:number;accountId?:number;taskId?:number}):void;
}) {
  if (!deps.config) return undefined;
  const config = deps.config, read = createReadSession(deps.pool, deps.database);
  async function deliver(command: 'ban' | 'replacement', values: number[]): Promise<CommandDelivery> {
    let eventId:string|undefined;
    try {
      if(command==='replacement'){
        const saved=await read(async s=>(await s.query('SELECT event_id,state FROM noco.crm_account_deliveries WHERE task_id=$1',values)).rows[0]);
        if(saved&&['review','superseded'].includes(String(saved.state)))return{state:'failed',code:'crm_account_command_'+saved.state,eventId:String(saved.event_id)};
        return saved?{state:saved.state==='sent'?'sent':'queued',eventId:String(saved.event_id)}:{state:'not_applicable'};
      }
      // Replacement delivery belongs exclusively to the durable outbox worker.
      const row = await read(async s => (await s.query(`
        SELECT l.client_id,l.platform_account_id AS account_id,l.version,l.crm_student_id,a.updated_at AS confirmed_at
        FROM noco.linklab l JOIN noco.clients c ON c.id=l.client_id
        JOIN noco.platform_accounts a ON a.id=l.platform_account_id AND a.clients_id=l.client_id
        WHERE l.client_id=$1 AND a.id=$2 AND a.is_banned
          AND NOT coalesce(a.__nc_deleted,false) AND NOT coalesce(c.__nc_deleted,false)`, values)).rows[0]);
      if (!row?.crm_student_id) return {state: 'failed', code: 'crm_account_not_linked_or_current'};
      eventId=randomUUID();
      const common = {event_id:eventId, client_id: String(row.client_id), account_id: String(row.account_id),
        linklab_version: String(row.version), confirmed_at: (row.confirmed_at instanceof Date
          ?row.confirmed_at:new Date(String(row.confirmed_at))).toISOString()};
      const body = accountCommandBody({command, ...common});
      // createReadSession has already rolled back/released before the external request.
      await sendAccountCommand({body, expectedStudentId: String(row.crm_student_id)}, {...config, fetch: deps.fetch});
      return {state:'sent',eventId};
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /^crm_account_command_[a-z0-9_]+$/.test(message) ? message : 'crm_account_command_unconfirmed';
      const refused = /^crm_account_command_http_4\d\d$/.test(code) || /_(payload|endpoint|secret|timestamp)_invalid$/.test(code);
      return {state: refused ? 'failed' : 'uncertain', code,...(eventId?{eventId}:{})};
    }
  }
  async function run(command:'ban'|'replacement',values:number[]){
    const result=await deliver(command,values);
    if(result.state==='failed'||result.state==='uncertain')deps.report?.({command,
      ...(command==='ban'?{clientId:values[0],accountId:values[1]}:{taskId:values[0]}),...result});
    return result;
  }
  return {ban:(clientId:number,accountId:number)=>run('ban',[clientId,accountId]),
    replacement:(taskId:number)=>run('replacement',[taskId])};
}

