import type { Column, Reader, Row, Table } from './contracts.mts';
import { primaryKeys } from './contracts.mts';
export interface Coverage { columns: Column[]; unavailable: string[]; fields: string; }
export async function selectColumns(reader: Reader, table: Table): Promise<Coverage> {
  const columns: Column[] = [], unavailable: string[] = [];
  const duplicates = table.columns.filter(c => table.columns.filter(x => x.title === c.title).length > 1);
  for (const column of table.columns) {
    if (duplicates.includes(column)) {
      const response = await reader.get<{ list: Row[] }>(`/api/v2/tables/${table.id}/records`,
        { limit: '1', fields: [...primaryKeys(table).map(c => c.id), column.id].join(',') });
      if (response.list.length && !(column.title in response.list[0])) { unavailable.push(column.id); continue; }
      if (columns.some(c => c.title === column.title)) throw new Error(`ambiguous_field_alias:${table.id}`);
    }
    columns.push(column);
  }
  return { columns, unavailable, fields: columns.map(c => c.id).join(',') };
}
export function checkCoverage(table: Table, selected: Coverage, row: Row): void {
  const names = new Set(selected.columns.map(c => c.title));
  if (Object.keys(row).some(key => !names.has(key))) throw new Error(`unmapped_row_field:${table.id}`);
  for (const c of selected.columns) {
    if (!(c.title in row) && !['CreatedBy', 'LastModifiedBy', 'Deleted', 'Meta'].includes(c.uidt))
      throw new Error(`missing_source_field:${table.id}:${c.id}`);
  }
}
