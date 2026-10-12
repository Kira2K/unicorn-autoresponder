import type { ConnectionOptions, SqlPool } from '../../../integrations/postgres/contracts.mts';
import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import { createPostgresPool } from '../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../integrations/postgres/working-client.mts';
import { createPostgresAppDb } from './postgres-db.mts';
import type { SheetsReads } from './postgres-db.mts';
import type { AppDbReader } from './record-source.mts';
import { readPostgresAppDbConfig } from './config.mts';
import { createReadSession } from '../../../integrations/postgres/read-session.mts';
import { readPolicies } from '../../../features/company-client-management/restrictions/read.mts';
import { hhPolicy } from '../../../features/company-client-management/restrictions/hh.mts';

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
let sharedConfig: ConnectionOptions | undefined;
export function createRuntimePostgresDb(sheets: SheetsReads) {
  return createPostgresAppDb(loadRuntimePostgresReader, sheets, async () => {
    const config=readPostgresAppDbConfig(process.env),pool=createPostgresPool(config);
    try { return await createReadSession(pool,config.database)(async s=>{
      const ledger=(await s.query("SELECT to_regclass('company_management.schema_migrations') AS ledger")).rows[0]?.ledger;
      if(!ledger)return undefined;
      const migrated=(await s.query("SELECT 1 FROM company_management.schema_migrations WHERE version='004_runtime'")).rows.length;
      return migrated?hhPolicy(await readPolicies(s,'hh')):undefined;
    }); }
    finally { await pool.end(); }
  });
}
export function loadRuntimePostgresReader(): Promise<AppDbReader> {
  if (!shared) {
    sharedConfig = readPostgresAppDbConfig(process.env);
    shared = createRuntimeReader(sharedConfig);
  }
  return shared.read();
}
export function runtimePostgresSourceIdentity() {
  return sharedConfig ? { host: sharedConfig.host, port: sharedConfig.port, database: sharedConfig.database } : undefined;
}
export async function closeRuntimePostgresDb() {
  if (shared) await shared.close();
}
