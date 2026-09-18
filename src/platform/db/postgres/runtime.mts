import type { ConnectionOptions, SqlPool } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../integrations/postgres/working-client.mts';
import { createPostgresAppDb } from './postgres-db.mts';
import type { SheetsReads } from './postgres-db.mts';
import type { AppDbReader } from './record-source.mts';
import { readPostgresAppDbConfig } from './config.mts';

export function createRuntimeReader(config: ConnectionOptions, open: (config: ConnectionOptions) => SqlPool = createPostgresPool) {
  let pool: SqlPool | undefined, ready: Promise<AppDbReader> | undefined, closed = false;
  let closing: Promise<void> | undefined;
  return {
    async read(): Promise<AppDbReader> {
      if (closed) throw new PostgresReadError('appdb_postgres_closed');
      pool ??= open(config);
      if (!ready) {
        const attempt = createPostgresClient(pool, config.database);
        ready = attempt;
        void attempt.catch(() => { if (ready === attempt) ready = undefined; });
      }
      return ready;
    },
    close() {
      closed = true;
      return closing ??= (async () => {
        if (ready) await ready.catch(() => {});
        await pool?.end();
      })();
    }
  };
}
// One pool per process; each AppDb retains its established per-instance data cache.
let shared: ReturnType<typeof createRuntimeReader> | undefined;
export function createRuntimePostgresDb(sheets: SheetsReads) {
  return createPostgresAppDb(loadRuntimePostgresReader, sheets);
}
export function loadRuntimePostgresReader(): Promise<AppDbReader> {
  shared ??= createRuntimeReader(readPostgresAppDbConfig(process.env));
  return shared.read();
}
export async function closeRuntimePostgresDb() {
  if (shared) await shared.close();
}
