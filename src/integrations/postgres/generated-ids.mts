import { PostgresReadError } from './contracts.mts';
import type { SqlSession } from './contracts.mts';
import type { WorkingTable } from './working-catalog.mts';
import { tableSql } from './working-catalog.mts';

export function generatedIdColumn(table: WorkingTable) {
  const keys = table.columns.filter(c => c.pk);
  if (keys.length !== 1 || keys[0].sqlType !== 'bigint') throw new PostgresReadError('record_key_required');
  return keys[0];
}
// Only the database allocates an absent key. Existing/imported keys are never replaced.
export async function assignGeneratedId(session: SqlSession, table: WorkingTable, data: Record<string, unknown>) {
  if (table.columns.filter(c => c.pk).every(c => Object.hasOwn(data, c.dataKey))) return;
  const column = generatedIdColumn(table);
  const result = await session.query('SELECT nextval(pg_get_serial_sequence($1,$2)::regclass)::text AS id',
    [tableSql(table), column.sqlName]);
  const id = result.rows[0]?.id;
  if (id == null) throw new PostgresReadError('postgres_id_allocator_required');
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id) || BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PostgresReadError('postgres_id_out_of_range');
  data[column.dataKey] = id;
}
