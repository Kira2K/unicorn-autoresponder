import { PostgresReadError } from './contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from './contracts.mts';
import { assertCopyDatabase } from './read-session.mts';
export async function writeTransaction<T>(pool: SqlPool, database: CopyDatabase,
  operation: (session: SqlSession) => Promise<T>): Promise<T> {
  let session: SqlSession | undefined, committing = false, broken = false;
  try {
    session = await pool.connect();
    await session.query('BEGIN READ WRITE');
    await assertCopyDatabase(session, database);
    const result = await operation(session);
    committing = true; await session.query('COMMIT'); return result;
  } catch (error) {
    broken = true;
    if (session) { try { await session.query('ROLLBACK'); } catch { /* discard connection */ } }
    if (committing) throw new PostgresReadError('commit_uncertain');
    if (error instanceof PostgresReadError) throw error;
    const code = (error as { code?: string } | null)?.code;
    throw new PostgresReadError(code === '23505' ? 'duplicate_record' : code === '23503' ? 'record_is_referenced' : 'postgres_write_failed');
  } finally { session?.release(broken); }
}
