export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;
export interface Column { id: string; title: string; column_name: string | null; uidt: string;
  pk?: boolean; ai?: boolean; dt?: string; colOptions?: Record<string, unknown>; }
export interface Table { id: string; title: string; table_name: string; columns: Column[]; }
export function primaryKeys(table: Table): Column[] {
  const keys = table.columns.filter(column => column.pk);
  if (!keys.length) throw new Error(`unsupported_primary_key:${table.id}`);
  return keys;
}
export interface Page { list?: Row[]; data?: Row[]; pageInfo?: {
  isLastPage?: boolean; totalRows?: number; pageSize?: number; }; }
export interface Reader { get<T>(path: string, query?: Record<string, string>): Promise<T>; }
export interface TableExport { id: string; rows: number; sha256: string; file: string; }
export interface Manifest { version: 1; baseId: string; startedAt: string; completedAt?: string;
  schemaHash: string; tables: TableExport[]; links: number; attachments: number; }
export function primary(table: Table): Column {
  const keys = table.columns.filter(column => column.pk);
  if (keys.length !== 1) throw new Error(`unsupported_primary_key:${table.id}`);
  return keys[0];
}
