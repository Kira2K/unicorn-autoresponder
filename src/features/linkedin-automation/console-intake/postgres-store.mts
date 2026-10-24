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
import type { LinkedInIntake } from './contracts.mts';
import { tableIds } from '../../web-console/backend/postgres/tables.mts';

const accountQuery = `SELECT a.id,a.platforms_id,a.url,a.login,a.password,a.linkedin_first_name,
  a.linkedin_last_name,a.real_location,a.old_link_blocked,lower(p.name) AS platform
  FROM noco.platform_accounts a JOIN noco.platforms p ON p.id=a.platforms_id
  WHERE a.clients_id=$1 AND lower(p.name) IN ('linkedin','email_outlook')
  AND NOT COALESCE(a.__nc_deleted,false) AND NOT COALESCE(p.__nc_deleted,false) ORDER BY a.id`;
function select(rows: Record<string, unknown>[], platform: string) {
  const candidates = rows.filter(r => r.platform === platform);
  if (candidates.length > 1) throw new PostgresReadError('linkedin_intake_account_ambiguous');
  return candidates[0];
}
export function createLinkedInIntakeStore(pool: SqlPool, database: CopyDatabase, linklab = false) {
  const read = createReadSession(pool, database);
  return {
    async checkSchema() { await read(async s => { await s.query(accountQuery + ' LIMIT 0', [0]); }); },
    async load(clientId: number) {
      return read(async s => {
        const rows = (await s.query(accountQuery, [clientId])).rows;
        const li = select(rows, 'linkedin'), email = select(rows, 'email_outlook');
        // No secret is returned; leaving a password blank preserves its current value.
        return { url: String(li?.url ?? ''), login: String(li?.login ?? ''), hasPassword: !!li?.password,
          outlookLogin: String(email?.login ?? ''), hasOutlookPassword: !!email?.password,
          firstName: String(li?.linkedin_first_name ?? ''), lastName: String(li?.linkedin_last_name ?? ''),
          realLocation: String(li?.real_location ?? ''), blockedAccounts: readBlockedAccounts(li?.old_link_blocked) };
      });
    },
    async save(clientId: number, data: LinkedInIntake, locales: string[], options = { createOctoProfiles: true }) {
      return writeTransaction(pool, database, async s => {
        // Use the same order as Octo reservation, then lock the student for all account saves.
        await s.query('SELECT pg_advisory_xact_lock(730644, $1::integer)', [clientId]);
        const client = (await s.query('SELECT id FROM noco.clients WHERE id=$1 AND NOT COALESCE(__nc_deleted,false) FOR UPDATE', [clientId])).rows[0];
        if (!client) throw new PostgresReadError('record_not_found');
        const rows = (await s.query(accountQuery + ' FOR UPDATE OF a', [clientId])).rows;
        const li = select(rows, 'linkedin'), email = select(rows, 'email_outlook');
        if (data.scenario === 'new' && String(li?.url ?? '').trim()) throw new PostgresReadError('linkedin_intake_existing_account');
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
          const profiles = (await s.query('SELECT locale,state FROM noco.octo_profiles WHERE client_id=$1', [clientId])).rows;
          if (!locales.every(locale => profiles.some(p => p.locale === locale &&
            (p.state as { phase?: string; deletion?: unknown }).phase === 'ready' && !(p.state as { deletion?: unknown }).deletion)) ||
            !profiles.some(p => p.locale === 'en' && (p.state as { proxy?: unknown }).proxy &&
              (!((p.state as { proxyChange?: { phase: string } }).proxyChange) ||
                (p.state as { proxyChange?: { phase: string } }).proxyChange?.phase === 'complete')))
            throw new PostgresReadError('linkedin_intake_infrastructure_required');
          linkedinAccountId = await upsert('linkedin', li, { url: data.url, login: data.login,
            ...(data.password ? { password: data.password } : {}) });
          if (linklab) await syncLinkLabAccount(s, clientId);
        } else {
          linkedinAccountId = await upsert('linkedin', li, { linkedin_first_name: data.firstName,
            linkedin_last_name: data.lastName, real_location: data.realLocation, old_link_blocked: JSON.stringify(data.blockedAccounts) });
          outlookAccountId = await upsert('email_outlook', email, { login: data.outlookLogin,
            ...(data.outlookPassword ? { password: data.outlookPassword } : {}) });
          if (options.createOctoProfiles) await queueDirectProfiles(s, clientId, locales);
        }
        return { saved: true, linkedinAccountId, ...(outlookAccountId ? { outlookAccountId } : {}) };
      });
    }
  };
}
async function queueDirectProfiles(s: SqlSession, clientId: number, locales: string[]) {
  const state = await claimClientPassword(s, clientId, generateProfilePassword());
  const profiles = (await s.query('SELECT locale,state FROM noco.octo_profiles WHERE client_id=$1', [clientId])).rows;
  if (profiles.some(p => (p.state as { deletion?: unknown })?.deletion)) throw new PostgresReadError('octo_profile_deleting');
  if (locales.every(locale => profiles.some(p => p.locale === locale))) return;
  if (state.setup?.phase === 'unknown') throw new PostgresReadError('octo_setup_outcome_unknown');
  if (state.setup && !['complete','blocked'].includes(state.setup.phase)) {
    if (state.setup.source === 'direct') return; // Same durable intent on a repeated save.
    throw new PostgresReadError('octo_setup_busy');
  }
  state.setup = { id: randomUUID(), source: 'direct', phase: 'provisioning', createdAt: Date.now(), confirmDolphin: false };
  await saveClientState(s, state);
}
