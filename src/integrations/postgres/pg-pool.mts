import { createRequire } from 'node:module';
import { PostgresReadError } from './contracts.mts';
import type { ConnectionOptions, SqlPool, SqlSession } from './contracts.mts';
interface DriverSession extends SqlSession {
  on(event: 'error', listener: (error: Error) => void): void;
  removeListener(event: 'error', listener: (error: Error) => void): void;
}
interface DriverPool extends SqlPool {
  connect(): Promise<DriverSession>;
  on(event: 'error', listener: () => void): void;
}
type PoolConstructor = new (options: Record<string, unknown>) => DriverPool;
export function createPostgresPool(config: ConnectionOptions,
  onError: (error: PostgresReadError) => void = () => {}, PoolOverride?: PoolConstructor): SqlPool {
  if (!['unicorn_noco_copy', 'unicorn_noco_copy_restore'].includes(config.database) ||
    !config.host || !config.user || !config.password || !Number.isInteger(config.port) ||
    config.port < 1 || config.port > 65535 || (config.ssl && (!config.ssl.ca || config.ssl.rejectUnauthorized !== true)))
    throw new PostgresReadError('invalid_postgres_config');
  if (!config.ssl && !['127.0.0.1', '::1', 'localhost'].includes(config.host))
    throw new PostgresReadError('tls_or_local_tunnel_required');
  const Pool = PoolOverride ?? (createRequire(import.meta.url)('pg') as { Pool: PoolConstructor }).Pool;
  const pool = new Pool({ host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password, ssl: config.ssl ?? false, max: 2,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, query_timeout: 15000,
    statement_timeout: 10000, application_name: 'unicorn-postgres-reader',
    options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c timezone=UTC' });
  const report = () => onError(new PostgresReadError('postgres_connection_failed'));
  pool.on('error', report);
  return {
    async connect(): Promise<SqlSession> {
      const client = await pool.connect();
      let failure: Error | undefined;
      // pg-pool handles idle errors only. Checked-out clients need their own listener.
      const failed = (error: Error) => { failure ??= error; report(); };
      client.on('error', failed);
      return {
        async query(text, values) {
          if (failure) throw failure;
          return client.query(text, values);
        },
        release(destroy = false) {
          // Transfer error handling back to pg-pool before removing our listener.
          try { client.release(destroy || failure !== undefined); }
          finally { client.removeListener('error', failed); }
        }
      };
    },
    end: () => pool.end()
  };
}
