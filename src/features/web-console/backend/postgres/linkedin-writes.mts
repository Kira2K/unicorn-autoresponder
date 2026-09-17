import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import type { PostgresTransaction } from '../../../../integrations/postgres/working-client.mts';
import { appDbRow } from '../../../../platform/db/postgres/record-relations.mts';
import { tableIds as t } from './tables.mts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
const accountFields = new Set(['url', 'unipile_account_id', 'unipile_account_status', 'linkedin_verified_provider_id',
  'linkedin_verified_profile_url', 'linkedin_verified_profile_name', 'linkedin_last_verified_at',
  'linkedin_auth_error_code', 'linkedin_auth_updated_at']);
const historyFields = new Set(['status', 'stage', 'error_code', 'finished_at']);
export function linkedInWrites(db: ConsoleSql, historyId: string, grant?: ConsoleWrites) {
  function owner(value: unknown) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || !grant || (!grant.allClients && !grant.clientIds.has(id)))
      throw new PostgresReadError('sql_linkedin_write_forbidden');
  }
  async function account(tx: PostgresTransaction, id: unknown) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new PostgresReadError('invalid_record_key');
    const row = await tx.getRecord(t.accounts, [String(id)]);
    if (!row || Number(row.data.platforms_id) !== 16) throw new PostgresReadError('sql_linkedin_write_forbidden');
    owner(row.data.clients_id);
  }
  return {
    async patchRecord(table: string, id: number, input: Record<string, unknown>) {
      const allowed = table === t.accounts ? accountFields : table === historyId ? historyFields : new Set<string>();
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      if (!allowed.size || Object.keys(patch).some(k => !allowed.has(k))) throw new PostgresReadError('sql_linkedin_write_forbidden');
      return db.transaction(async tx => {
        if (table === historyId) {
          const row = await tx.getRecord(table, [String(id)]);
          if (!row) throw new PostgresReadError('record_not_found');
          await account(tx, row.data.platform_account_id);
        } else await account(tx, id);
        return appDbRow(await tx.patchRecord(table, [String(id)], patch));
      });
    },
    async createRecord(table: string, data: Record<string, unknown>) {
      const allowed = new Set(['run_id', 'platform_account_id', 'client_name', 'action', 'status', 'stage', 'started_at']);
      if (table !== historyId || !grant || Object.keys(data).some(k => !allowed.has(k)))
        throw new PostgresReadError('sql_linkedin_write_forbidden');
      return db.transaction(async tx => {
        await account(tx, data.platform_account_id);
        return appDbRow(await grant.create(tx, table, data));
      });
    },
    async link(_client: unknown, table: { id: string }, field: string, source: number, targets: number[]) {
      const definition = db.listTables().find(v => v.id === t.clients);
      const expected = definition?.columns.find(c => c.title === 'rel_clients_primary_stack');
      if (table.id !== t.clients || field !== expected?.id || targets.length !== 1)
        throw new PostgresReadError('sql_linkedin_write_forbidden');
      owner(source);
      try {
        await db.transaction(tx => tx.linkRecord(t.clients, field, [String(source)], [String(targets[0])]));
        return { ok: true };
      } catch { return { ok: false }; }
    }
  };
}
