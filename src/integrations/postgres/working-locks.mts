import { PostgresReadError } from './contracts.mts';
import type { SqlSession } from './contracts.mts';
import type { WorkingCatalog } from './working-catalog.mts';
// Transaction-scoped logical reservation, including a key whose row does not exist yet.
export function workingLocks(session: SqlSession, catalog: WorkingCatalog) {
  return { async lockKey(tableId: string, key: string): Promise<void> {
    catalog.get(tableId);
    if (typeof key !== 'string' || !key || key.length > 4096 || key.includes('\0'))
      throw new PostgresReadError('invalid_lock_key');
    await session.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))', [JSON.stringify([tableId, key])]);
  } };
}
