import { PostgresReadError } from '../../../integrations/postgres/contracts.mts';
import type { ConnectionOptions } from '../../../integrations/postgres/contracts.mts';

export function readPostgresAppDbConfig(env: Readonly<Record<string, string | undefined>>): ConnectionOptions {
  const database = env.APP_DB_POSTGRES_DATABASE, host = env.APP_DB_POSTGRES_HOST?.trim();
  const port = Number(env.APP_DB_POSTGRES_PORT ?? 5432);
  const user = env.APP_DB_POSTGRES_USER, password = env.APP_DB_POSTGRES_PASSWORD;
  const ca = env.APP_DB_POSTGRES_SSL_CA;
  if (!host || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535 ||
    (database !== 'unicorn_noco_copy' && database !== 'unicorn_noco_copy_restore'))
    throw new PostgresReadError('invalid_appdb_postgres_config');
  if (!ca && !['127.0.0.1', '::1', 'localhost'].includes(host))
    throw new PostgresReadError('tls_or_local_tunnel_required');
  return { database, host, port, user, password, ...(ca ? { ssl: { ca, rejectUnauthorized: true as const } } : {}) };
}
