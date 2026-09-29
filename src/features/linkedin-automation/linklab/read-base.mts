import type { SqlPool } from '../../../integrations/postgres/contracts.mts';
import { linkLabBaseQuery } from './base-query.mts';

/** One consistent read; no app startup, fallback, writes, or external actions. */
export async function readLinkLabBase(pool: SqlPool, expectedDatabase: string) {
  if (!['unicorn_noco_copy', 'unicorn_noco_copy_restore'].includes(expectedDatabase)) {
    throw new Error('linklab_database_not_allowed');
  }
  const session = await pool.connect();
  let failed = false;
  try {
    await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await session.query(`SELECT current_database() AS database,
      current_setting('transaction_read_only') AS read_only`);
    if (rows[0]?.database !== expectedDatabase || rows[0]?.read_only !== 'on') {
      throw new Error('linklab_read_target_mismatch');
    }
    const result = await session.query(`${linkLabBaseQuery} ORDER BY c.id`);
    await session.query('ROLLBACK');
    return result.rows;
  } catch (error) {
    failed = true;
    await session.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { session.release(failed); }
}
