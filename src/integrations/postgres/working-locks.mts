import { PostgresReadError } from './contracts.mts';
import type { SqlSession } from './contracts.mts';
import type { WorkingCatalog } from './working-catalog.mts';
import { tableSql } from './working-catalog.mts';
import { encodeKey } from './records.mts';
// Transaction-scoped logical reservation, including a key whose row does not exist yet.
export function workingLocks(session: SqlSession, catalog: WorkingCatalog) {
  return { async lockRecord(tableId: string, key: string[]): Promise<void> {
    const table = catalog.get(tableId);
    await session.query(`SELECT _copy_id FROM ${tableSql(table)} WHERE _copy_id=$1 FOR UPDATE`, [encodeKey(table, key)]);
  }, async lockKey(tableId: string, key: string): Promise<void> {
    catalog.get(tableId);
    if (typeof key !== 'string' || !key || key.length > 4096 || key.includes('\0'))
      throw new PostgresReadError('invalid_lock_key');
    await session.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [JSON.stringify([tableId, key])]);
  } };
}
