import type { SqlPool, ConnectionOptions } from '../../integrations/postgres/contracts.mts';
import { createClientIdRuntime } from './runtime.mts';
import { clientIdStore, clientIdSubscription } from './postgres.mts';
import { createTelegramIdResolver } from './resolver.mts';

export function clientIdRuntime(env: NodeJS.ProcessEnv, pool: SqlPool, config: ConnectionOptions) {
  if (env.TELEGRAM_CLIENT_ID_ENABLED !== '1') return undefined;
  const resolver = createTelegramIdResolver();
  const runtime = createClientIdRuntime({
    store: clientIdStore(pool, config.database), subscribe: clientIdSubscription(config),
    resolve: username => resolver.resolve(username),
    report: event => console.error(JSON.stringify({ feature: 'telegram-client-id', ...event }))
  });
  return { start: runtime.start, async stop() {
    const stopping = runtime.stop();
    try { await resolver.close(); } finally { await stopping; }
  } };
}
