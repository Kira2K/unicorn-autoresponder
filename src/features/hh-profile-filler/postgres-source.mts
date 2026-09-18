import { createRequire } from 'node:module';
import { PostgresReadError } from '../../integrations/postgres/contracts.mts';
import { readPages } from '../../platform/db/postgres/pages.mts';
import { nocoRecordOrder } from '../../platform/db/postgres/record-order.mts';
import { appDbRow, attachBelongsTo } from '../../platform/db/postgres/record-relations.mts';
import { createPostgresRecordSource } from '../../platform/db/postgres/record-source.mts';
import type { AppDbReader } from '../../platform/db/postgres/record-source.mts';
const { TABLES } = createRequire(import.meta.url)('../../integrations/noco/core/schema.ts') as {
  TABLES: Record<string, { id: string }>;
};
const allowed = new Set(['clients', 'hhAutoresponses', 'dolphinProfiles', 'platformAccounts', 'cvProcessing', 'stacks']
  .map(key => TABLES[key].id));
const extraRelations = {
  [TABLES.clients.id]: ['English level', TABLES.englishLevels.id],
  [TABLES.platformAccounts.id]: ['rel_platformAccounts_platform', TABLES.platforms.id]
};

export function createProfileFillerPostgresSource(load: () => Promise<AppDbReader>) {
  const appDb = createPostgresRecordSource(load);
  return { async fetchRecords(tableId: string) {
    if (!allowed.has(tableId)) throw new PostgresReadError('hh_profile_table_not_allowed');
    const reader = await load(), tables = reader.listTables(), table = tables.find(t => t.id === tableId);
    if (!table) throw new PostgresReadError('table_not_allowed');
    const readAll = (id: string) => readPages(after => reader.listRecords(id, { limit: 100, after }));
    const rows = tableId === TABLES.cvProcessing.id ? (await readAll(tableId)).map(appDbRow)
      : await appDb.fetchRecords(tableId);
    const relation = extraRelations[tableId];
    if (relation) await attachBelongsTo(rows, table, tables, relation[0], relation[1], readAll);
    // SQL UTC timestamps use T; Noco returns a space. Keep the existing CV revision representation.
    for (const field of table.columns.filter(c => c.sqlType === 'timestamptz')) {
      for (const row of rows) {
        const value = row[field.dataKey];
        if (typeof value === 'string') row[field.dataKey] = value.replace(/^(\d{4}-\d{2}-\d{2})T/, '$1 ');
      }
    }
    return nocoRecordOrder(rows);
  } };
}
