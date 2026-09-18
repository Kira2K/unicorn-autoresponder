import { createCatalog, quoted } from './catalog.mts';
export { quoted, tableSql } from './catalog.mts';
import { PostgresReadError } from './contracts.mts';
import type { TableInfo } from './contracts.mts';
import { withLocalColumns } from './local-columns.mts';
export interface WorkingColumn { id: string; title: string; pk?: boolean; uidt?: string;
  colOptions?: Record<string, unknown>; sqlName: string; sqlType: string; dataKey: string; sqlOnly?: boolean; }
export interface WorkingTable extends Omit<TableInfo, 'columns'> { columns: WorkingColumn[]; }
export const virtualTypes = new Set(['Links', 'LinkToAnotherRecord', 'Lookup', 'Rollup', 'Formula']);
const types = new Set(['text', 'bigint', 'numeric', 'boolean', 'date', 'timestamptz', 'jsonb']);
export function createWorkingCatalog(rows: Record<string, unknown>[]) {
  rows = withLocalColumns(rows);
  const base = createCatalog(rows), definitions = new Map(rows.map(r => {
    const d = r.definition as TableInfo & { mapping?: unknown }; return [d.id, d];
  }));
  function get(id: string): WorkingTable {
    const table = base.get(id), definition = definitions.get(id)!;
    if (!Array.isArray(definition.mapping)) throw new PostgresReadError('column_mapping_required');
    const columns = table.columns.map(c => {
      const matches = (definition.mapping as Record<string, unknown>[]).filter(m => m.id === c.id);
      const m = matches[0];
      if (matches.length !== 1 || m.title !== c.title || typeof m.sqlName !== 'string' ||
        typeof m.sqlType !== 'string' || !types.has(m.sqlType)) throw new PostgresReadError('invalid_column_mapping');
      quoted(m.sqlName);
      if (m.sqlName.startsWith('_copy_')) throw new PostgresReadError('protected_column');
      const dataKey = table.columns.filter(other => other.title === c.title).length > 1 ? c.id : c.title;
      return { ...c, sqlName: m.sqlName, sqlType: m.sqlType, dataKey };
    });
    const physical = columns.filter(c => !virtualTypes.has(c.uidt ?? ''));
    for (const key of ['dataKey', 'sqlName'] as const)
      if (new Set(physical.map(c => c[key])).size !== physical.length) throw new PostgresReadError('ambiguous_columns');
    return { ...table, columns };
  }
  function column(id: unknown) {
    const owners = base.list().filter(t => t.columns.some(c => c.id === id));
    if (owners.length !== 1) throw new PostgresReadError('relation_column_not_allowed');
    const table = get(owners[0].id); return { table, column: table.columns.find(c => c.id === id)! };
  }
  return { get, column, list: base.list };
}
export type WorkingCatalog = ReturnType<typeof createWorkingCatalog>;
