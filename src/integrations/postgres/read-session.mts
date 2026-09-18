import { COPY_MARKER, PostgresReadError } from './contracts.mts';
import type { CopyDatabase, SqlPool, SqlSession } from './contracts.mts';
// Read-only failures only. SQLSTATE: https://www.postgresql.org/docs/16/errcodes-appendix.html
const temporaryReadCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', '08000', '08001', '08003', '08006',
  '57P01', '57P02', '57P03', '53300', '57014', '40001', '40P01']);
// pg 8.23 / pg-pool driver errors omit code. Match exact constants, never arbitrary timeout text.
const driverReadFailures = new Set(['Query read timeout', 'Connection terminated unexpectedly', 'timeout expired',
  'timeout exceeded when trying to connect', 'Connection terminated due to connection timeout']);
export async function assertCopyDatabase(session: SqlSession, database: CopyDatabase) {
  if (!['unicorn_noco_copy', 'unicorn_noco_copy_restore'].includes(database))
    throw new PostgresReadError('database_not_allowed');
  const result = await session.query(`SELECT current_database() AS database,
    shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
  if (result.rows[0]?.database !== database || result.rows[0]?.marker !== COPY_MARKER)
    throw new PostgresReadError('database_not_allowed');
}
export function createReadSession(pool: SqlPool, database: CopyDatabase) {
  if (!['unicorn_noco_copy', 'unicorn_noco_copy_restore'].includes(database))
    throw new PostgresReadError('database_not_allowed');
  return async function read<T>(operation: (session: SqlSession) => Promise<T>): Promise<T> {
    let session: SqlSession | undefined, destroy = false;
    try {
      session = await pool.connect();
      await session.query('BEGIN READ ONLY');
      await assertCopyDatabase(session, database);
      return await operation(session);
    } catch (error) {
      destroy = true;
      if (error instanceof PostgresReadError) throw error;
      // Provider messages can contain credentials, SQL and row values. Do not propagate them.
      const code = (error as { code?: unknown } | null)?.code;
      const unavailable = typeof code === 'string' ? temporaryReadCodes.has(code)
        : code == null && error instanceof Error && driverReadFailures.has(error.message);
      throw new PostgresReadError(unavailable
        ? 'postgres_read_unavailable' : 'postgres_read_failed');
    } finally {
      if (session) {
        try { await session.query('ROLLBACK'); } catch { destroy = true; }
        session.release(destroy);
      }
    }
  };
}
