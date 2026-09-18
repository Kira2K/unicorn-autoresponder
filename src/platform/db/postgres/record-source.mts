import { createRequire } from 'node:module';
import type { createPostgresClient } from '../../../integrations/postgres/working-client.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { readPages } from './pages.mts';
import { appDbRow as row, attachBelongsTo } from './record-relations.mts';
import { nocoRecordOrder } from './record-order.mts';
const { TABLES } = createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>;
};
export type AppDbReader = Pick<Awaited<ReturnType<typeof createPostgresClient>>, 'listTables' | 'listRecords' | 'listRelated'>;
export type AppDbRow = Record<string, unknown> & { Id: number };
const relations: Record<string, { title: string; type: string; target: string }[]> = {
  [TABLES.clients.id]: [{ title: 'rel_clients_primary_stack', type: 'bt', target: TABLES.stacks.id }],
  [TABLES.hhAutoresponses.id]: [{ title: 'Stack Override', type: 'bt', target: TABLES.stacks.id }],
  [TABLES.restrictions.id]: [{ title: 'rel_restrictions_blocked_companies', type: 'mm', target: TABLES.companies.id }]
};
const allowed = new Set(['clients', 'hhAutoresponses', 'dolphinProfiles', 'stacks', 'restrictions', 'platformAccounts']
  .map(key => TABLES[key].id));
// Keep the established AppDb mapping; only replace its record source, never its business rules.
export function createPostgresRecordSource(load: () => Promise<AppDbReader>) {
  return { async fetchRecords(tableId: string): Promise<AppDbRow[]> {
    if (!allowed.has(tableId)) throw new PostgresReadError('appdb_table_not_allowed');
    const reader = await load(), tables = reader.listTables(), table = tables.find(t => t.id === tableId);
    if (!table) throw new PostgresReadError('table_not_allowed');
    const readAll = (id: string) => readPages(after => reader.listRecords(id, { limit: 100, after }));
    const records = await readAll(tableId), result = records.map(row);
    for (const expected of relations[tableId] ?? []) {
      const { title } = expected;
      const columns = table.columns.filter(c => c.title === title), field = columns[0], o = field?.colOptions;
      if (columns.length !== 1 || !o || o.type !== expected.type || o.fk_related_model_id !== expected.target)
        throw new PostgresReadError('appdb_relation_required');
      if (o.type === 'bt') {
        if (!allowed.has(expected.target)) throw new PostgresReadError('appdb_relation_required');
        await attachBelongsTo(result, table, tables, title, expected.target, readAll);
      } else {
        for (let i = 0; i < records.length; i++) result[i][title] = nocoRecordOrder((await readPages(after =>
          reader.listRelated(tableId, field.id, records[i].key, { limit: 100, after }))).map(row));
      }
    }
    return nocoRecordOrder(result);
  } };
}
