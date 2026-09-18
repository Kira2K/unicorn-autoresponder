import { PostgresReadError } from './contracts.mts';
import { decodeRecord, encodeKey } from './records.mts';
import type { CopyRecord } from './contracts.mts';
import { quoted, virtualTypes } from './working-catalog.mts';
import type { WorkingColumn, WorkingTable } from './working-catalog.mts';
export const physicalColumns = (t: WorkingTable) => t.columns.filter(c => !virtualTypes.has(c.uidt ?? ''));
const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
export function projection(table: WorkingTable, alias = 't'): string {
  const pairs = physicalColumns(table).map(c => `${literal(c.dataKey)},${alias}.${quoted(c.sqlName)}`);
  // Concatenate objects in small chunks: PostgreSQL limits arguments per function call.
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += 40) chunks.push(`jsonb_build_object(${pairs.slice(i, i + 40).join(',')})`);
  return `${alias}._copy_id AS record_key, (${chunks.join(' || ') || "'{}'::jsonb"})::text AS source_json`;
}
export function parameter(column: WorkingColumn, value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' ||
    (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))))
    throw new PostgresReadError('invalid_field_value');
  if (value === null) return null;
  if (column.sqlType === 'jsonb') {
    try { return JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined || (typeof item === 'number' && (!Number.isFinite(item) ||
        (Number.isInteger(item) && !Number.isSafeInteger(item))))) throw new Error('invalid_json');
      return item;
    }); } catch { throw new PostgresReadError('invalid_json_value'); }
  }
  if (!['string', 'number', 'boolean'].includes(typeof value)) throw new PostgresReadError('invalid_field_value');
  if (column.sqlType === 'text' && typeof value !== 'string') throw new PostgresReadError('invalid_text_value');
  return value;
}
export function checkedRecord(table: WorkingTable, row: Record<string, unknown>): CopyRecord {
  return checkKey(table, decodeRecord(row));
}
export function checkKey(table: WorkingTable, record: CopyRecord): CopyRecord {
  const actual = table.columns.filter(c => c.pk).map(c => String(record.data[c.dataKey]));
  if (encodeKey(table, record.key) !== JSON.stringify(actual)) throw new PostgresReadError('record_key_mismatch');
  return record;
}
export function fields(table: WorkingTable, data: Readonly<Record<string, unknown>>, creating = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PostgresReadError('invalid_fields');
  const result = Object.keys(data).map(name => {
    const c = physicalColumns(table).find(c => c.dataKey === name);
    if (!c || (!creating && c.pk)) throw new PostgresReadError('field_not_writable');
    return { column: c, value: parameter(c, data[name]) };
  });
  if (!result.length) throw new PostgresReadError('empty_patch');
  return result;
}
export function createKey(table: WorkingTable, data: Readonly<Record<string, unknown>>): string {
  const key = table.columns.filter(c => c.pk).map(c => {
    const value = data[c.dataKey];
    if (value === null || value === undefined) throw new PostgresReadError('record_key_required');
    parameter(c, value); return String(value);
  });
  return encodeKey(table, key);
}
