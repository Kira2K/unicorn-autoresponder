import { PostgresReadError } from './contracts.mts';
import type { TableInfo } from './contracts.mts';
// Fixed IDs also protect CRM tables if their display names are changed.
const CRM_IDS = new Set(['md7qid29wv5q0bd', 'mo1jh7mxqvk6yih', 'mubh0nbskdf62hf', 'mhwnnjci2clae7e']);
export function isCrmTable(table: Pick<TableInfo, 'id' | 'title' | 'table_name'>): boolean {
  return CRM_IDS.has(table.id) || [table.title, table.table_name].some(name =>
    /(?:^|_)linkedin_manager(?:_|$)|(?:^|_)crm(?:_|$)/i.test(name));
}
export function identifier(id: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(id)) throw new PostgresReadError('invalid_identifier');
  return '"' + id + '"';
}
export function quoted(name: string): string {
  if (typeof name !== 'string' || !name || name.includes('\0') || Buffer.byteLength(name) > 63)
    throw new PostgresReadError('invalid_column');
  return '"' + name.replaceAll('"', '""') + '"';
}
export const tableSql = (t: TableInfo) => `noco.${quoted(t.sqlName ?? t.id)}`;
export function createCatalog(rows: Record<string, unknown>[]) {
  const tables = new Map<string, TableInfo>(), physicalNames = new Set<string>();
  for (const row of rows) {
    const table = row.definition as TableInfo | undefined;
    if (!table || typeof table.id !== 'string' || typeof table.title !== 'string' ||
      typeof table.table_name !== 'string' || !Array.isArray(table.columns))
      throw new PostgresReadError('invalid_table_metadata');
    identifier(table.id);
    if (tables.has(table.id)) throw new PostgresReadError('duplicate_table_metadata');
    const physical = table.sqlName ?? table.id;
    quoted(physical);
    if (table.sqlName !== undefined && table.sqlTable !== `noco.${physical}` || physicalNames.has(physical) ||
        !isCrmTable(table) && isCrmTable({ ...table, table_name: physical }))
      throw new PostgresReadError('invalid_table_mapping');
    physicalNames.add(physical);
    tables.set(table.id, structuredClone(table));
  }
  function get(id: string): TableInfo {
    identifier(id);
    const table = tables.get(id);
    if (!table || isCrmTable(table)) throw new PostgresReadError('table_not_allowed');
    return table;
  }
  return { get, list: () => [...tables.values()].filter(t => !isCrmTable(t)).map(t => structuredClone(t)) };
}
