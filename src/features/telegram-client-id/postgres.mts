import { createRequire } from 'node:module';
import { createReadSession, assertCopyDatabase } from '../../integrations/postgres/read-session.mts';
import { writeTransaction } from '../../integrations/postgres/working-session.mts';
import type { CopyDatabase, SqlPool, ConnectionOptions } from '../../integrations/postgres/contracts.mts';
import type { Candidate, Store } from './runtime.mts';

const eligible = `NOT COALESCE(__nc_deleted,false)
  AND NULLIF(btrim(client_tg_id),'') IS NULL
  AND NULLIF(btrim(telegram_personal_chat_id),'') IS NOT NULL`;

export function clientIdStore(pool: SqlPool, database: CopyDatabase): Store {
  const read = createReadSession(pool, database);
  return {
    pending: after => read(async s => (await s.query(
      `SELECT id::text FROM noco.clients WHERE ${eligible} AND id>$1::bigint ORDER BY noco.clients.id LIMIT 100`, [after]
    )).rows.map(r => String(r.id))),
    get: id => read(async s => {
      const row = (await s.query(`SELECT id::text,telegram_personal_chat_id AS username
        FROM noco.clients WHERE id=$1::bigint AND ${eligible}`, [id])).rows[0];
      return row ? { id: String(row.id), username: String(row.username) } : undefined;
    }),
    save: (row: Candidate, telegramId: string) => writeTransaction(pool, database, async s => {
      if (!/^[1-9]\d*$/.test(telegramId)) throw Error('invalid_telegram_id');
      const result = await s.query(`UPDATE noco.clients SET client_tg_id=$3
        WHERE id=$1::bigint AND telegram_personal_chat_id=$2 AND ${eligible} RETURNING id`,
      [row.id, row.username, telegramId]);
      return result.rows.length === 1;
    })
  };
}

type ListenerClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  on(event: string, callback: (...args: any[]) => void): void;
  end(): Promise<void>;
};

export function clientIdSubscription(config: ConnectionOptions, makeClient?: () => ListenerClient) {
  return async (onId: (id: string) => void, onLost: () => void) => {
    const client: ListenerClient = makeClient ? makeClient() : new (createRequire(import.meta.url)('pg').Client)({
      ...config, ssl: config.ssl ?? false, connectionTimeoutMillis: 5000,
      query_timeout: 10000, application_name: 'unicorn-telegram-client-id',
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog'
    });
    let closed = false;
    const close = async () => { if (closed) return; closed = true; await client.end().catch(() => {}); };
    const lost = () => { if (!closed) onLost(); };
    client.on('error', lost); client.on('end', lost);
    client.on('notification', message => {
      if (!closed && message.channel === 'unicorn_client_tg_id') onId(String(message.payload ?? ''));
    });
    try {
      await client.connect();
      await assertCopyDatabase({ query: (q, p) => client.query(q, p), release() {} }, config.database);
      await client.query('LISTEN unicorn_client_tg_id');
      return close;
    } catch (error) { await close(); throw error; }
  };
}
