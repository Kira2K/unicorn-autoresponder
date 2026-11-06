import { createPostgresPool } from '../../../../integrations/postgres/pg-pool.mts';
import {routeLocalTestNotice,localTestChat} from '../../../linkedin-automation/local-console/notification-target.mts';
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
import { linkedInCrmSyncStore } from '../../../linkedin-automation/console-intake/crm-sync.mts';
import { createSecuredGroupReader } from './secured-group.mts';
import { readOctoConfig } from '../../../octo-access/config.mts';
import { createOctoPostgresStore } from '../../../octo-access/postgres-store.mts';
import { createOctoRuntime } from '../../../octo-access/runtime.mts';
import type { OctoService } from '../../../octo-access/service.mts';
import { readControlConfig } from '../../../octo-access/control-config.mts';
import { createControlAcquire } from '../../../octo-access/control-client.mts';
import { controlRoutes } from '../../../octo-access/control-routes.mts';
import { createCloudApi } from '../../../octo-access/cloud-api.mts';
import { createProxyChecker } from '../../../octo-access/proxy-checker.mts';
import { createProxyConnectivityCheck } from '../../../octo-access/proxy-connectivity.mts';
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
import {createAccountCommandActions,readAccountCommandConfig} from '../../../linkedin-automation/linklab/crm-account-actions.mts';
import {createAccountDeliveryWorker} from '../../../linkedin-automation/linklab/crm-account-delivery.mts';
import { createCreationTaskStore } from '../../../linkedin-automation/creation-tasks/postgres-store.mts';
import { createCreationTaskService } from '../../../linkedin-automation/creation-tasks/service.mts';
import { createTaskProxyCapture } from '../../../linkedin-automation/creation-tasks/proxy-capture.mts';
import { guardAccount } from '../../../linkedin-automation/creation-tasks/account-guard.mts';
import { createTaskStatusReporter,DEFAULT_NOTIFICATION_MENTION } from '../../../linkedin-automation/creation-tasks/status-report.mts';
import {taskProxyStore} from '../../../linkedin-automation/creation-tasks/proxy-store.mts';
import {createNewTaskProxy} from '../../../linkedin-automation/creation-tasks/new-proxy-service.mts';
import {cycleNotificationRuntime,cycleNotificationStore,deliverCycleNotification} from '../../../linkedin-automation/creation-tasks/cycle-notifications.mts';
import {existingNotificationStore,deliverExistingNotification} from '../../../linkedin-automation/console-intake/existing-notifications.mts';
import {createProxyMoveStore} from '../../../linkedin-automation/proxy-move/postgres-store.mts';
import {createProxyMoveService} from '../../../linkedin-automation/proxy-move/service.mts';
import {moveNoticeStore,deliverMoveNotice} from '../../../linkedin-automation/proxy-move/notifications.mts';
import {manualProxyUrl} from '../../../octo-access/manual-proxy-check.mts';
import type {SendOneInput} from '../../../../integrations/telegram/types.ts';
import {createBridgeErrorReporter} from '../../../octo-access/bridge/error-reports.mts';
import { createRequire } from 'node:module';

export async function openSqlConsole(env: NodeJS.ProcessEnv, open = createPostgresPool) {
  const crmCommandConfig=readAccountCommandConfig(env);
  const localClientIds=(env.LINKEDIN_LOCAL_TEST_CLIENT_IDS||env.LINKEDIN_LOCAL_TEST_CLIENT_ID||'').split(',').filter(Boolean).map(Number);
  if(localClientIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new OctoError('octo_local_test_configuration_required',503);
  const bridgeConfig = readBridgeConfig(env);
  const control = readControlConfig(env);
  const config = readPostgresAppDbConfig(env), pool = open(config);
  let closing: Promise<void> | undefined;
  let octo: ReturnType<typeof createOctoRuntime> | undefined, octoLockPool: ReturnType<typeof createPostgresPool> | undefined;
  let octoBridge: ReturnType<typeof bridgeRoutes> | undefined;
  let octoControl: ReturnType<typeof controlRoutes> | undefined, octoService: OctoService | undefined;
  let lifecycle: ReturnType<typeof createLifecycleRuntime> | undefined;
  let linkedinIntake: ReturnType<typeof createLinkedInIntakeService> | undefined;
  let linkedinCreator: ReturnType<typeof createCreationTaskService> | undefined;
  let cycleNotices:ReturnType<typeof cycleNotificationRuntime>|undefined;
  let existingNotices:ReturnType<typeof cycleNotificationRuntime>|undefined;
  let linkedinProxyMove:ReturnType<typeof createProxyMoveService>|undefined;
  let moveNotices:ReturnType<typeof cycleNotificationRuntime>|undefined;
  const crmDeliveries=crmCommandConfig?createAccountDeliveryWorker({pool,database:config.database,config:crmCommandConfig,
    report:event=>console.error(JSON.stringify(event))}):undefined;
  const close = () => closing ??= (async () => {
    try { await crmDeliveries?.stop();await moveNotices?.stop();await cycleNotices?.stop();await existingNotices?.stop();await lifecycle?.stop(); } finally {
      try { await octo?.stop(); } finally { try { await octoLockPool?.end(); } finally { await pool.end(); } }
    }
  })();
  try {
    const db = await createPostgresClient(pool, config.database, { writable: true,
      beforeWrite: async (s,table,key,data) => { if(table===tableIds.accounts) await guardAccount(s,key,data); } });
    await assertGeneratedIds(pool, config.database, runtimeCreateTables(db));
    await crmDeliveries?.checkSchema();
    const crmSync=linkedInCrmSyncStore(pool,config.database);await crmSync.checkSchema();
    const create = (tx: PostgresTransaction, table: string, data: Readonly<Record<string, unknown>>) => tx.createRecord(table, data);
    const linklab = env.LINKLAB_ENABLED === '1' ? await openLinkLabIntake(pool, config.database, tableIds.cv) : undefined;
    const options = sqlAppOptions(db, { clientIds: new Set(), allClients: true, create, linklab,readLinkedInCrmFlags:crmSync.readFlags },
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
    if (control && !octoConfig) throw new OctoError('octo_control_configuration_required', 503);
    if (octoConfig) {
      // The advisory-lock connection must not occupy the two application pool slots.
      octoLockPool = open(config);
      const octoStore = createOctoPostgresStore(pool, config.database, octoLockPool);
      await octoStore.checkSchema();
      const clients = await Promise.all((octoConfig.allowAll ? [] : [...octoConfig.allowedClientIds]).map(id => options.repository.getClientById(id)));
      if (clients.some(c => !c.id || !c.calendarEmail))
        throw Object.assign(new Error('octo_pilot_clients_required'), { code: 'octo_pilot_clients_required' });
      const api = createCloudApi(env.OCTO_API_TOKEN!);
      const proxyConnectivity = createProxyConnectivityCheck();
      const proxyChecker=env.PROXY_CHECKER_BASE_URL&&env.UNICORN_PROXY_CHECKER_SECRET_KEY ? createProxyChecker({baseUrl:env.PROXY_CHECKER_BASE_URL,secret:env.UNICORN_PROXY_CHECKER_SECRET_KEY}):undefined;
      let taskTelegram: ReturnType<typeof import('../../../../integrations/telegram/index.ts').telegramForReports> | undefined;
      const sendTaskNotice=(input:SendOneInput)=>{
        taskTelegram ??= (createRequire(import.meta.url)('../../../../integrations/telegram/index.ts') as
          typeof import('../../../../integrations/telegram/index.ts')).telegramForReports(localTestChat,env);
        return taskTelegram.sendOne(routeLocalTestNotice(input,localClientIds));
      };
      octo = createOctoRuntime({ store: octoStore, api, config: octoConfig, passwordBridge: bridgeConfig, allowLegacyChecks: false,
        reportBridgeIncident:createBridgeErrorReporter({store:octoStore,client:id=>options.repository.getClientById(id),sendOne:sendTaskNotice}),
        token: env.OCTO_API_TOKEN!, getClient: id => options.repository.getClientById(id),
        onboarding: {
          manualCheck: proxyConnectivity,
          developmentHelp: createCheckerDevelopmentHelp(env),
          checker: env.PROXY_CHECKER_BASE_URL && env.UNICORN_PROXY_CHECKER_SECRET_KEY
            ? createProxyChecker({ baseUrl: env.PROXY_CHECKER_BASE_URL, secret: env.UNICORN_PROXY_CHECKER_SECRET_KEY })
            : { check: async () => { throw new OctoError('octo_checker_configuration_required', 503); },
              best: async () => { throw new OctoError('octo_checker_configuration_required', 503); } },
          catalogue: createNodeMavenCatalogue(),
          dolphin: createDolphinProxySource({ profiles: id => options.repository.getDolphinProfilesForClient(id) })
        },
        report: event => console.error(JSON.stringify({ feature: 'octo', ...event })) });
      octoService = control?.url ? { ...octo.service, acquire: createControlAcquire({ ...control, url: control.url,
        store: octoStore, config: octoConfig, allowed: octo.service.allowed }) } : octo.service;
      if (control && !control.url) octoControl = controlRoutes({ secret: control.secret, store: octoStore,
        config: octoConfig, service: octo.service, ready: uuid => octo!.grantReady(uuid) });
      const crmCommands=createAccountCommandActions({pool,database:config.database,config:crmCommandConfig,
        report:event=>console.error(JSON.stringify({feature:'crm_account_command',...event}))});
      const intakeStore = createLinkedInIntakeStore(pool, config.database, !!linklab, true,crmCommands?.ban, !localClientIds.length);
      await intakeStore.checkSchema();
      linkedinIntake = createLinkedInIntakeService({ store: intakeStore, allowed: id => octo!.service.allowed(id),
        getClient: id => options.repository.getClientById(id),
        hasDolphin: async id => (await options.repository.getDolphinProfilesForClient(id)).length > 0 });
      const tasks = createCreationTaskStore(pool,config.database,!!linklab,undefined,localClientIds);
      await tasks.checkSchema();
      const notificationMention=DEFAULT_NOTIFICATION_MENTION;
      if(env.LINKEDIN_PROXY_MOVE_ENABLED==='1') {
        const moves=createProxyMoveStore(pool,config.database);await moves.checkSchema();
        linkedinProxyMove=createProxyMoveService({store:moves,profiles:octoStore,account:id=>intakeStore.load(id),
          allowed:id=>octo!.service.allowed(id)&&(!localClientIds.length||localClientIds.includes(id)),hasDolphin:async id=>(await options.repository.getDolphinProfilesForClient(id)).length>0,
          client:id=>options.repository.getClientById(id),
          check:async input=>{if(!proxyChecker)throw new OctoError('octo_checker_configuration_required',503);return proxyChecker.check(manualProxyUrl(input));},
          previousProxy:async uuid=>{if(!api.readProfileProxy)throw new OctoError('octo_proxy_check_failed',503);return api.readProfileProxy(uuid);}});
        moveNotices=cycleNotificationRuntime(()=>deliverMoveNotice({store:moveNoticeStore(pool,config.database,localClientIds.length?localClientIds:undefined),
          client:id=>options.repository.getClientById(id),sendOne:sendTaskNotice,testChatId:localTestChat}),code=>console.error(JSON.stringify({feature:'linkedin-proxy-move',code})));
      }
      existingNotices=cycleNotificationRuntime(()=>deliverExistingNotification({store:existingNotificationStore(pool,config.database),mention:DEFAULT_NOTIFICATION_MENTION,
        client:id=>options.repository.getClientById(id),sendOne:sendTaskNotice}),code=>console.error(JSON.stringify({feature:'linkedin',code})));
      cycleNotices=cycleNotificationRuntime(()=>deliverCycleNotification({store:cycleNotificationStore(pool,config.database,localClientIds.length?localClientIds:undefined,localTestChat),
        client:id=>options.repository.getClientById(id),sendOne:sendTaskNotice}),code=>console.error(JSON.stringify({feature:'linkedin',code})));
      const reportStatusChange = createTaskStatusReporter({chatId:env.LINKEDIN_LOCAL_TEST_CLIENT_ID?'-5216637594':'-1003187558078',mention:notificationMention,
        client:id=>options.repository.getClientById(id),
        sendOne:sendTaskNotice});
      linkedinCreator = createCreationTaskService({ store: tasks, profiles: octoStore, octo: octoService,
        client: id => options.repository.getClientById(id),
        secrets: (id,account) => options.repository.getPlatformAccountSecrets(id,account),
        capture: createTaskProxyCapture({store:octoStore,api,config:octoConfig,octo:octo.service}),
        newProxy:createNewTaskProxy({store:taskProxyStore(pool,config.database),api,check:async p=>{
          const checked=await proxyConnectivity(p);
          return checked.exit_ip||'';
        }}),
        nodeMavenKey: () => env.NODEMAVEN_API_KEY || '', reportStatusChange,notificationMention });
      if (bridgeConfig) octoBridge = bridgeRoutes(createBridgeBroker({ store: octoStore, api, config: octoConfig,
        bridge: bridgeConfig, checkpoint: () => octo!.bridgeCheckpoint() }), bridgeConfig,
        event=>console.error(JSON.stringify(event)));
    }
    return { options: { ...options, ...(octoService ? { octoService } : {}), ...(linkedinIntake ? { linkedinIntake } : {}),...(linkedinProxyMove?{linkedinProxyMove}:{}),
      ...(linkedinCreator ? { linkedinCreator, linkedinCreatorAuth: { login: env.LINKEDIN_CREATOR_LOGIN || '', password: env.LINKEDIN_CREATOR_PASSWORD || '' } } : {}) }, close, octoBridge, octoControl,
      startLocalBackground:async()=>{if(!control?.url||!localClientIds.length)throw new OctoError('octo_control_configuration_required',503);await moveNotices?.start();await cycleNotices?.start();},
      startBackground: async () => { if (!control?.url) await octo?.start(); await lifecycle?.start();await cycleNotices?.start();await existingNotices?.start();await moveNotices?.start();await crmDeliveries?.start(); } };
  } catch (error) { await close(); throw error; }
}
