import { createCatalog } from './catalog.mts';
import { PostgresReadError } from './contracts.mts';
import type { TableInfo } from './contracts.mts';
type Definition = Omit<TableInfo, 'columns'> & { columns: (TableInfo['columns'][number] & { sqlOnly?: true })[];
  mapping: { id: string; title: string; sqlName: string; sqlType: string }[] };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PostgresReadError('invalid_local_columns');
  return value as Record<string, unknown>;
}
// Local definitions live in separate inventory rows; never modify the source Noco schema.
export function withLocalColumns(rows: Record<string, unknown>[]) {
  const source = rows.filter(r => !Object.hasOwn(object(r.definition), 'sqlOnlyFor'));
  const base = createCatalog(source), result = structuredClone(source);
  for (const row of rows.filter(r => Object.hasOwn(object(r.definition), 'sqlOnlyFor'))) {
    const extension = object(row.definition);
    if (Object.hasOwn(extension, 'sqlTable') || typeof extension.sqlOnlyFor !== 'string' || !Array.isArray(extension.columns))
      throw new PostgresReadError('invalid_local_columns');
    const allowed = base.get(extension.sqlOnlyFor);
    const table = result.find(r => object(r.definition).id === allowed.id)!.definition as Definition;
    if (!Array.isArray(table.mapping)) throw new PostgresReadError('column_mapping_required');
    for (const entry of extension.columns) {
      const c = object(entry), name = c.name;
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(name) || c.sqlType !== 'text')
        throw new PostgresReadError('invalid_local_columns');
      const id = `sql-only:${table.id}:${name}`;
      if (table.columns.some(col => col.title === name || col.id === id) || table.mapping.some(m => m.sqlName === name))
        throw new PostgresReadError('local_column_conflict');
      table.columns.push({ id, title: name, uidt: 'LongText', sqlOnly: true });
      table.mapping.push({ id, title: name, sqlName: name, sqlType: 'text' });
    }
  }
  return result;
}
// Shared export boundary: SQL-only diagnostics must not enter a Noco payload/archive.
export function sourceFields(columns: readonly { dataKey: string; sqlOnly?: boolean }[], input: Readonly<Record<string, unknown>>) {
  const shared = new Set(columns.filter(c => !c.sqlOnly).map(c => c.dataKey));
  return Object.fromEntries(Object.entries(input).filter(([name]) => shared.has(name)));
}
