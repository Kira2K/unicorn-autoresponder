import { createRequire } from 'node:module';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { readPages } from '../../../../platform/db/postgres/pages.mts';
import { appDbRow, attachBelongsTo } from '../../../../platform/db/postgres/record-relations.mts';
import { nocoRecordOrder } from '../../../../platform/db/postgres/record-order.mts';
import { tableIds as t } from './tables.mts';
import { filterRows } from './query.mts';
import type { ConsoleSql } from './contracts.mts';
const require = createRequire(import.meta.url);
const { LINKEDIN_AUTH_COLUMNS } = require('../../../../integrations/noco/linkedin-auth-schema/logic.ts') as {
  LINKEDIN_AUTH_COLUMNS: Array<{ title: string }> };
const { LINKEDIN_AUTH_RUN_COLUMNS } = require('../../../../integrations/noco/linkedin-auth-runs-schema/columns.ts') as {
  LINKEDIN_AUTH_RUN_COLUMNS: Array<{ title: string }> };
export function linkedInRecords(db: ConsoleSql) {
  const tables = db.listTables(), histories = tables.filter(t => t.title === 'linkedin_auth_runs');
  if (histories.length !== 1) throw new PostgresReadError('sql_linkedin_history_table_required');
  const historyId = histories[0].id;
  const required: Record<string, string[]> = {
    [t.clients]: ['Id', 'client_name', 'rel_clients_primary_stack'],
    [t.accounts]: ['Id', 'clients_id', 'platforms_id', 'url', ...LINKEDIN_AUTH_COLUMNS.map(c => c.title)],
    [t.profiles]: ['Id', 'clients_id', 'locale', 'dolphin_profile_id'], [t.stacks]: ['Id', 'name'],
    [historyId]: ['Id', ...LINKEDIN_AUTH_RUN_COLUMNS.map(c => c.title)]
  };
  function table(id: string) {
    const found = tables.find(t => t.id === id);
    if (!Object.hasOwn(required, id) || !found) throw new PostgresReadError('sql_linkedin_table_not_allowed');
    return found;
  }
  for (const [id, fields] of Object.entries(required))
    if (fields.some(name => table(id).columns.filter(c => c.title === name).length !== 1))
      throw new PostgresReadError('sql_linkedin_columns_required');
  const links = [[t.clients, 'rel_clients_primary_stack', t.stacks],
    [t.accounts, 'rel_platformAccounts_client', t.clients], [t.profiles, 'rel_dolphinProfiles_client', t.clients]];
  for (const [id, title, target] of links) {
    const columns = table(id).columns.filter(c => c.title === title), o = columns[0]?.colOptions;
    if (columns.length !== 1 || o?.type !== 'bt' || o.fk_related_model_id !== target ||
      !table(id).columns.some(c => c.id === o.fk_child_column_id) ||
      !table(target).columns.some(c => c.id === o.fk_parent_column_id))
      throw new PostgresReadError('sql_linkedin_relation_required');
  }
  const all = (id: string) => { table(id); return readPages(after => db.listRecords(id, { limit: 100, after })); };
  return {
    historyId, config: { baseId: 'sql-copy' }, wait: async (_ms: number) => {},
    async fetchTableMeta(id: string) { return structuredClone(table(id)); },
    async request(method: string, endpoint: string) {
      if (method !== 'get' || endpoint !== '/api/v2/meta/bases/sql-copy/tables')
        throw new PostgresReadError('sql_linkedin_request_not_allowed');
      return [structuredClone(table(historyId))];
    },
    async fetchRecords(id: string, _pageSize?: number, query?: { where?: string; sort?: string }, _options?: { fresh?: boolean }) {
      const definition = table(id), byId = /^\(Id,eq,([1-9]\d*)\)$/.exec(query?.where ?? '');
      const one = byId ? await db.getRecord(id, [byId[1]]) : null;
      const rows = filterRows((byId ? one ? [one] : [] : await all(id)).map(appDbRow), query?.where);
      for (const [source, title, target] of links) if (source === id)
        await attachBelongsTo(rows, definition, tables, title, target, all);
      for (const field of definition.columns.filter(c => c.sqlType === 'timestamptz'))
        for (const row of rows) if (typeof row[field.dataKey] === 'string')
          row[field.dataKey] = String(row[field.dataKey]).replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ');
      const ordered = nocoRecordOrder(rows);
      if (query?.sort) {
        if (id !== historyId || query.sort !== '-started_at') throw new PostgresReadError('sql_linkedin_sort_unsupported');
        ordered.sort((a, b) => Number(b.started_at == null) - Number(a.started_at == null) ||
          String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
      }
      return ordered;
    }
  };
}
