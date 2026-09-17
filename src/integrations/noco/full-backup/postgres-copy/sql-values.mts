import type { Column, Json, Table } from './contracts.mts';
import { canonical } from './json.mts';
export const ident = (value: string): string => '"' + value.replaceAll('"', '""') + '"';
export function literal(value: string): string {
  if (value.includes('\0')) throw new Error('postgres_cannot_store_nul');
  return "'" + value.replaceAll("'", "''") + "'";
}
export type SqlNames = ReadonlyMap<string, string> & { types?: ReadonlyMap<string, string> };
export const tableName = (table: Pick<Table, 'id'>, names?: SqlNames): string => names?.get(table.id) ?? table.id;
export const columnName = (column: Column, names?: SqlNames): string => names?.get(column.id) ?? (column.column_name || `v_${column.id}`);
export function sqlType(column: Column, names?: SqlNames): string {
  const override = names?.types?.get(column.id);
  if (override !== undefined) {
    if (column.uidt !== 'MultiSelect' || override !== 'text') throw new Error('invalid_sql_type_override');
    return override;
  }
  if (['ID', 'ForeignKey'].includes(column.uidt)) return 'bigint';
  if (['Number', 'Order', 'Decimal', 'Currency', 'Percent', 'Rating'].includes(column.uidt)) return 'numeric';
  if (['Checkbox', 'Deleted'].includes(column.uidt)) return 'boolean';
  if (column.uidt === 'Date') return 'date';
  if (['CreatedTime', 'LastModifiedTime', 'DateTime'].includes(column.uidt)) return 'timestamptz';
  if (['CreatedBy', 'LastModifiedBy', 'Meta', 'JSON', 'MultiSelect', 'Links', 'LinkToAnotherRecord',
    'Lookup', 'Rollup', 'Formula', 'Attachment'].includes(column.uidt)) return 'jsonb';
  if (['SingleLineText', 'LongText', 'URL', 'Email', 'PhoneNumber', 'SingleSelect'].includes(column.uidt)) return 'text';
  throw new Error(`unsupported_column_type:${column.id}`);
}
export function sqlValue(value: Json | undefined, type: string): string {
  if (value === undefined || value === null) return `NULL::${type}`;
  if (type === 'jsonb') return `${literal(canonical(value))}::jsonb`;
  if (type === 'text' && typeof value !== 'string') throw new Error('non_text_source_value');
  const text = typeof value === 'string' ? value : canonical(value);
  return `${literal(text)}::${type}`;
}
