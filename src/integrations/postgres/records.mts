import { PostgresReadError } from './contracts.mts';
import type { CopyRecord, PageOptions, RecordKey, RecordPage, TableInfo } from './contracts.mts';
export function encodeKey(table: TableInfo, key: RecordKey): string {
  const count = table.columns.filter(c => c.pk).length;
  if (!count || !Array.isArray(key) || key.length !== count ||
    key.some(part => typeof part !== 'string' || part.length > 1024))
    throw new PostgresReadError('invalid_record_key');
  return JSON.stringify(key);
}
export function pageSize(options: PageOptions): number {
  const size = options.limit ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new PostgresReadError('invalid_page_size');
  return size;
}
export function decodeRecord(row: Record<string, unknown>): CopyRecord {
  if (typeof row.record_key !== 'string' || typeof row.source_json !== 'string')
    throw new PostgresReadError('invalid_record_result');
  const key: unknown = JSON.parse(row.record_key);
  if (!Array.isArray(key) || key.some(v => typeof v !== 'string')) throw new PostgresReadError('invalid_record_result');
  const data: unknown = JSON.parse(row.source_json, ((_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source && JSON.stringify(value) !== context.source
      ? context.source : value) as Parameters<typeof JSON.parse>[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PostgresReadError('invalid_record_result');
  return { key, data: data as Record<string, unknown>, sourceJson: row.source_json };
}
export function recordPage(rows: Record<string, unknown>[], limit: number): RecordPage {
  const records = rows.slice(0, limit).map(decodeRecord);
  return { records, nextKey: rows.length > limit ? records.at(-1)!.key : null };
}
