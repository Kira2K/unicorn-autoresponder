import { createPostgresPool } from '../../../../integrations/postgres/pg-pool.mts';
import { createPostgresClient } from '../../../../integrations/postgres/working-client.mts';
import type { PostgresTransaction } from '../../../../integrations/postgres/working-client.mts';
import { assertGeneratedIds } from '../../../../integrations/postgres/identity-preflight.mts';
import { readPostgresAppDbConfig } from '../../../../platform/db/postgres/config.mts';
import { sqlAppOptions } from './app-options.mts';
import { runtimeCreateTables } from './runtime-tables.mts';
import { openLinkLabIntake } from '../../../linkedin-automation/linklab/intake-runtime.mts';
import { tableIds } from './tables.mts';
import { studentProfileStore } from './student-profile-store.mts';
import { withStudentProfile } from './student-profile-repository.mts';
import { createSecuredGroupReader } from './secured-group.mts';
import { readOctoConfig } from '../../../octo-access/config.mts';
import { createOctoPostgresStore } from '../../../octo-access/postgres-store.mts';
import { createOctoRuntime } from '../../../octo-access/runtime.mts';
import { createCloudApi } from '../../../octo-access/cloud-api.mts';
import { createProxyChecker } from '../../../octo-access/proxy-checker.mts';
import { createCheckerDevelopmentHelp } from '../../../octo-access/checker-development-help.mts';
import { createNodeMavenCatalogue } from '../../../octo-access/nodemaven-locations.mts';
import { createDolphinProxySource } from '../../../octo-access/dolphin-proxy-source.mts';
import { OctoError } from '../../../octo-access/contracts.mts';
import { readBridgeConfig } from '../../../octo-access/bridge/config.mts';
import { createBridgeBroker } from '../../../octo-access/bridge/broker.mts';
import { bridgeRoutes } from '../../../octo-access/bridge/routes.mts';
import { clientLifecycleStore } from '../../../client-lifecycle/postgres-store.mts';
import { runLifecyclePass } from '../../../client-lifecycle/pass.mts';
import { createLifecycleRuntime } from '../../../client-lifecycle/runtime.mts';
import { createClientSender } from '../../../client-lifecycle/sender.mts';
import { loadClientNotificationSettings } from '../../../client-lifecycle/postgres-settings.mts';
import { createLinkedInIntakeStore } from '../../../linkedin-automation/console-intake/postgres-store.mts';
import { createLinkedInIntakeService } from '../../../linkedin-automation/console-intake/service.mts';

export async function openSqlConsole(env: NodeJS.ProcessEnv, open = createPostgresPool) {
  const bridgeConfig = readBridgeConfig(env);
  const config = readPostgresAppDbConfig(env), pool = open(config);
  let closing: Promise<void> | undefined;
  let octo: ReturnType<typeof createOctoRuntime> | undefined, octoLockPool: ReturnType<typeof createPostgresPool> | undefined;
  let octoBridge: ReturnType<typeof bridgeRoutes> | undefined;
  let lifecycle: ReturnType<typeof createLifecycleRuntime> | undefined;
  let linkedinIntake: ReturnType<typeof createLinkedInIntakeService> | undefined;
  const close = () => closing ??= (async () => {
    try { await lifecycle?.stop(); } finally {
      try { await octo?.stop(); } finally { try { await octoLockPool?.end(); } finally { await pool.end(); } }
    }
  })();
  try {
    const db = await createPostgresClient(pool, config.database, { writable: true });
    await assertGeneratedIds(pool, config.database, runtimeCreateTables(db));
    const create = (tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>) => tx.createRecord(table, data);
    const linklab = env.LINKLAB_ENABLED === '1' ? await openLinkLabIntake(pool, config.database, tableIds.cv) : undefined;
    const options = sqlAppOptions(db, { clientIds: new Set(), allClients: true, create, linklab },
      { accountIds: new Set(), allAccounts: true, create });
    const store = studentProfileStore(pool, config.database);
    await store.checkSchema();
    options.repository = withStudentProfile(options.repository, store);
    options.repository.findSecuredGroupByTelegramTag = createSecuredGroupReader(pool, config.database);
    if (env.CLIENT_LIFECYCLE_ENABLED === '1') {
      const { messageConfig, supportChatId } = await loadClientNotificationSettings(pool, config.database);
      const lifecycleStore = clientLifecycleStore(pool, config.database);
      const send = createClientSender(supportChatId, env, lifecycleStore.delivery);
      lifecycle = createLifecycleRuntime({ enabled: true,
        pass: ({ now, reminders, reminderAt }) => runLifecyclePass({ store: lifecycleStore, supportChatId, send,
          messageConfig, now, apply: true, statuses: true, reminders, reminderAt }),
        report: event => console.error(JSON.stringify(event)) });
    }
    const octoConfig = readOctoConfig(env);
    if (bridgeConfig && !octoConfig) throw new OctoError('octo_bridge_configuration_required', 503);
    if (octoConfig) {
      // The advisory-lock connection must not occupy the two application pool slots.
      octoLockPool = open(config);
      const octoStore = createOctoPostgresStore(pool, config.database, octoLockPool);
      await octoStore.checkSchema();
      const clients = await Promise.all((octoConfig.allowAll ? [] : [...octoConfig.allowedClientIds]).map(id => options.repository.getClientById(id)));
      if (clients.some(c => !c.id || !c.calendarEmail))
        throw Object.assign(new Error('octo_pilot_clients_required'), { code: 'octo_pilot_clients_required' });
      const api = createCloudApi(env.OCTO_API_TOKEN!);
      octo = createOctoRuntime({ store: octoStore, api, config: octoConfig, passwordBridge: bridgeConfig, allowLegacyChecks: false,
        token: env.OCTO_API_TOKEN!, getClient: id => options.repository.getClientById(id),
        onboarding: {
          developmentHelp: createCheckerDevelopmentHelp(env),
          checker: env.PROXY_CHECKER_BASE_URL && env.UNICORN_PROXY_CHECKER_SECRET_KEY
            ? createProxyChecker({ baseUrl: env.PROXY_CHECKER_BASE_URL, secret: env.UNICORN_PROXY_CHECKER_SECRET_KEY })
            : { check: async () => { throw new OctoError('octo_checker_configuration_required', 503); },
              best: async () => { throw new OctoError('octo_checker_configuration_required', 503); } },
          catalogue: createNodeMavenCatalogue(),
          dolphin: createDolphinProxySource({ profiles: id => options.repository.getDolphinProfilesForClient(id) })
        },
        report: event => console.error(JSON.stringify({ feature: 'octo', ...event })) });
      const intakeStore = createLinkedInIntakeStore(pool, config.database, !!linklab);
      await intakeStore.checkSchema();
      linkedinIntake = createLinkedInIntakeService({ store: intakeStore, allowed: id => octo!.service.allowed(id),
        getClient: id => options.repository.getClientById(id),
        hasDolphin: async id => (await options.repository.getDolphinProfilesForClient(id)).length > 0 });
      if (bridgeConfig) octoBridge = bridgeRoutes(createBridgeBroker({ store: octoStore, api, config: octoConfig,
        bridge: bridgeConfig, checkpoint: () => octo!.bridgeCheckpoint() }), bridgeConfig);
    }
    return { options: { ...options, ...(octo ? { octoService: octo.service } : {}), ...(linkedinIntake ? { linkedinIntake } : {}) }, close, octoBridge,
      startBackground: async () => { await octo?.start(); await lifecycle?.start(); } };
  } catch (error) { await close(); throw error; }
}
