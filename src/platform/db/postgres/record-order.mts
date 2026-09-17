import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { AppDbRow } from './record-source.mts';

// Noco's default list order is nc_order, then numeric primary key, not JSON key order.
// Compare NUMERIC(40,20) without rounding through JavaScript Number.
function orderValue(value: unknown): bigint | null {
  if (value == null) return null;
  const parts = /^([+-]?)(\d+)(?:\.(\d{1,20}))?$/.exec(String(value));
  if (!parts) throw new PostgresReadError('appdb_order_invalid');
  const scaled = BigInt(parts[2]) * 10n ** 20n + BigInt((parts[3] ?? '').padEnd(20, '0'));
  return parts[1] === '-' ? -scaled : scaled;
}
export function nocoRecordOrder<T extends AppDbRow>(rows: T[]): T[] {
  const hasOrder = rows.some(row => Object.hasOwn(row, 'nc_order'));
  const ranked = rows.map(row => ({ row, order: hasOrder ? orderValue(row.nc_order) : BigInt(row.Id) }));
  return ranked.sort((a, b) => {
    if (a.order === b.order) return a.row.Id - b.row.Id;
    if (a.order === null) return 1;
    if (b.order === null) return -1;
    return a.order < b.order ? -1 : 1;
  }).map(item => item.row);
}
