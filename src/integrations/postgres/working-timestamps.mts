import type { WorkingTable } from './working-catalog.mts';
import { PostgresReadError } from './contracts.mts';
// Preserve Noco's system timestamps, without changing supplied business fields or imported dates.
export function automaticTimestamps(table: WorkingTable, input: Readonly<Record<string, unknown>>, creating: boolean) {
  const columns = table.columns.filter(c => !(c.dataKey in input) &&
    (c.uidt === 'LastModifiedTime' || (creating && c.uidt === 'CreatedTime')));
  if (columns.some(c => c.sqlType !== 'timestamptz')) throw new PostgresReadError('system_timestamp_type_invalid');
  return columns;
}
