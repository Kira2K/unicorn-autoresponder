import { createRequire } from 'node:module'
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts'
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts'
import { assertCopyDatabase } from '../../../integrations/postgres/read-session.mts'
import { createWorkingCatalog } from '../../../integrations/postgres/working-catalog.mts'
import { workingReads } from '../../../integrations/postgres/working-reads.mts'
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts'
import type { SqlSession } from '../../../integrations/postgres/contracts.mts'
import type { WorkingCatalog } from '../../../integrations/postgres/working-catalog.mts'
export const { TABLES } = createRequire(import.meta.url)('../../../integrations/noco/core/schema.ts') as { TABLES: Record<string, { id: string }> }
export type DatabaseRead = <T>(operation: (session: SqlSession, catalog: WorkingCatalog, reader: ReturnType<typeof workingReads>) => Promise<T>) => Promise<T>

/** Same checked pool/catalog as the application; no migrations or writes. */
export function createDatabaseRead(env: NodeJS.ProcessEnv = process.env): DatabaseRead {
  if (env.APP_DB !== 'postgres') throw Error('external_responses_requires_working_postgres')
  const config = readPostgresAppDbConfig(env)
  return async operation => {
    const pool = createPostgresPool(config)
    let session: SqlSession | undefined, broken = false
    let stage = 'connect'
    try {
      session = await pool.connect()
      stage = 'begin'
      await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
      stage = 'identity'
      await assertCopyDatabase(session, config.database)
      stage = 'catalog'
      const catalog = createWorkingCatalog((await session.query("SELECT definition FROM copy_meta.inventory WHERE definition ? 'sqlTable' OR definition ? 'sqlOnlyFor' ORDER BY id")).rows)
      stage = 'operation'
      return await operation(session, catalog, workingReads(session, catalog))
    } catch (error) {
      broken = true
      if (error instanceof PostgresReadError) throw error
      const code = (error as { code?: unknown })?.code
      const safeCode = typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? ':' + code : ''
      const local = error instanceof Error && /^[a-z_]{5,80}$/.test(error.message) ? ':' + error.message : ''
      throw new PostgresReadError(`external_database_read_failed:${stage}${safeCode || local}`)
    } finally {
      if (session) { try { await session.query('ROLLBACK') } catch { broken = true }; session.release(broken) }
      await pool.end()
    }
  }
}
