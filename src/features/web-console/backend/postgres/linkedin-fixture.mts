import { createRequire } from 'node:module';
import { workflowFixture } from './workflow-fixture.mts';
import { tableIds as t } from './tables.mts';
import type { ConsoleSql } from './contracts.mts';
import type { WorkingColumn, WorkingTable } from '../../../../integrations/postgres/working-catalog.mts';
import type { AuthHistory, AuthRepository } from './linkedin-contracts.mts';
import { legacyFixtureRows } from './legacy-query-fixture.mts';
const require = createRequire(import.meta.url);
const { createLinkedInAuthNocoRepository } = require('../../../linkedin-automation/account-connection/noco-repository.ts') as {
  createLinkedInAuthNocoRepository(client: unknown): AuthRepository };
const { createLinkedInAuthHistoryStore } = require('../linkedin-auth-history-store.ts') as {
  createLinkedInAuthHistoryStore(client: unknown): AuthHistory };
export const authHistoryId = 'auth_runs_fixture';
export function linkedInFixture() {
  const f = workflowFixture(), tables = f.db.listTables();
  const addColumn = (id: string, title: string, extra = {}) => {
    const table = tables.find(t => t.id === id)!;
    if (!table.columns.some(c => c.title === title)) table.columns.push({ id: id + '_' + title,
      title, dataKey: title, sqlName: title, sqlType: /_at$/.test(title) ? 'timestamptz' : 'text', ...extra } as WorkingColumn);
  };
  tables.push({ id: authHistoryId, title: 'linkedin_auth_runs', columns: [] } as unknown as WorkingTable);
  const fields = { [t.clients]: ['client_name'], [t.profiles]: ['locale', 'dolphin_profile_id'], [t.stacks]: ['name'],
    [t.accounts]: ['clients_id', 'url', 'unipile_account_id', 'unipile_account_status', 'linkedin_verified_provider_id',
      'linkedin_verified_profile_url', 'linkedin_verified_profile_name', 'linkedin_last_verified_at',
      'linkedin_auth_error_code', 'linkedin_auth_updated_at'], [authHistoryId]: ['Id', 'run_id', 'platform_account_id',
      'client_name', 'action', 'status', 'stage', 'error_code', 'started_at', 'finished_at'] };
  for (const [id, titles] of Object.entries(fields)) for (const title of titles) addColumn(id, title);
  addColumn(t.accounts, 'rel_platformAccounts_client', { colOptions: { type: 'bt', fk_related_model_id: t.clients,
    fk_child_column_id: t.accounts + '_clients_id', fk_parent_column_id: t.clients + '_pk' } });
  f.rows.get(t.accounts)!.get('21')!.linkedin_url = null;
  Object.assign(f.rows.get(t.accounts)!.get('21')!, { url: 'https://www.linkedin.com/in/sql-test/',
    linkedin_auth_error_code: '', unipile_account_id: 'fake-unipile', linkedin_last_verified_at: '2026-09-01 00:00:00.000Z' });
  f.set(t.profiles, 31, { clients_id: 7, locale: 'En', dolphin_profile_id: '7001' });
  f.set(t.stacks, 2, { name: 'Python' });
  let uncertainCommit = false;
  const db = { ...f.db, async linkRecord(_table, _field, source, target) {
    await f.db.patchRecord(t.clients, source, { stacks_id: Number(target[0]) });
  }, async transaction(fn) {
    const before = structuredClone(f.rows);
    let value;
    try { value = await fn({ ...db, async lockKey() {} }); } catch (error) { f.rows.clear(); for (const [id, rows] of before) f.rows.set(id, rows); throw error; }
    if (uncertainCommit) throw Object.assign(Error('unknown commit'), { code: 'write_outcome_unknown' });
    return value;
  } } satisfies ConsoleSql;
  const port = { config: { baseId: 'fixture' }, wait: async () => {},
    fetchTableMeta: async (id: string) => tables.find(t => t.id === id),
    async fetchRecords(id: string, _size?: number, query?: { where?: string; sort?: string }) {
      f.assertReadable();
      const rows = legacyFixtureRows([...f.rows.get(id)?.values() ?? []], query?.where);
      for (const row of rows) {
        if (id === t.clients) row.rel_clients_primary_stack = f.rows.get(t.stacks)?.get(String(row.stacks_id)) ?? null;
        if (id === t.accounts) row.rel_platformAccounts_client = f.rows.get(t.clients)?.get(String(row.clients_id)) ?? null;
        if (id === t.profiles) row.rel_dolphinProfiles_client = f.rows.get(t.clients)?.get(String(row.clients_id)) ?? null;
      }
      if (query?.sort) rows.sort((a,b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
      return rows;
    },
    createRecord: async (id: string, data: Record<string, unknown>) => (await f.db.createRecord(id, data)).data,
    patchRecord: async (id: string, key: number, data: Record<string, unknown>) => (await f.db.patchRecord(id, [String(key)], data)).data,
    async request(method: string, _endpoint: string, body?: unknown) {
      if (method === 'get') return [{ id: authHistoryId, title: 'linkedin_auth_runs' }];
      const ids = body as Array<{ Id: number }>;
      await f.db.patchRecord(t.clients, ['7'], { stacks_id: ids[0].Id }); return true;
    }
  };
  return { ...f, db, port, legacy: { repository: createLinkedInAuthNocoRepository(port), history: createLinkedInAuthHistoryStore(port) },
    uncertain: (value = true) => { uncertainCommit = value; } };
}
