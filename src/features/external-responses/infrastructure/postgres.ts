import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts'
import { readPostgresAppDbConfig } from '../../../platform/db/postgres/config.mts'
import { createReadSession } from '../../../integrations/postgres/read-session.mts'
import { writeTransaction } from '../../../integrations/postgres/working-session.mts'
import type { SqlSession, SqlPool, CopyDatabase } from '../../../integrations/postgres/contracts.mts'
export type SqlOperation = <T>(fn: (session: SqlSession) => Promise<T>) => Promise<T>
export type RuntimeDatabase = { read: SqlOperation; write: SqlOperation; pool: SqlPool; database: CopyDatabase; close(): Promise<void> }
export function createRuntimeDatabase(env: NodeJS.ProcessEnv = process.env): RuntimeDatabase {
  if (env.APP_DB !== 'postgres') throw Error('external_responses_requires_working_postgres')
  const config = readPostgresAppDbConfig(env), pool = createPostgresPool(config)
  return { pool, database: config.database, read: createReadSession(pool, config.database), write: fn => writeTransaction(pool, config.database, fn), close: () => pool.end() }
}
