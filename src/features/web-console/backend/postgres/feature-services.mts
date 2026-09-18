import { createRequire } from 'node:module';
import { PostgresReadError } from '../../../../integrations/postgres/contracts.mts';
import { createSqlProfileStore } from '../../../linkedin-automation/storage-postgres/profile-store.mts';
import { createSqlCommentStore } from '../../../linkedin-automation/storage-postgres/comment-store.mts';
import { createSqlInviterStore } from '../../../linkedin-automation/storage-postgres/inviter-store.mts';
import { createSqlPostStore } from '../../../linkedin-automation/storage-postgres/post-store.mts';
import { createConnectionInviterService } from '../../../linkedin-automation/connection-inviter/service.ts';
import { createPostWriterService } from '../../../linkedin-automation/post-writer/service.ts';
import type { Gate } from '../../../linkedin-automation/post-writer/types.ts';
import type { ProfileFillerService } from '../profile-filler-types.ts';
import type { CommentMonitorService } from '../comment-monitor-types.ts';
import type { ConsoleSql, ConsoleWrites } from './contracts.mts';
import type { SqlFeatureProviders } from './feature-providers.mts';
import { createSqlLinkedInStorage } from './linkedin-repository.mts';
import { createSqlAuthTestService } from './linkedin-test-service.mts';
import { createFeatureCv } from './feature-cv.mts';
const require = createRequire(import.meta.url);
const { createProfileFillerService } = require('../../../linkedin-automation/profile-filler/service.ts') as {
  createProfileFillerService(options: Record<string, unknown>): ProfileFillerService };
const { createCommentMonitorService } = require('../../../linkedin-automation/comment-monitor/service.ts') as {
  createCommentMonitorService(options: Record<string, unknown>): CommentMonitorService };
const { createLinkedInOperationGate } = require('../linkedin-operation-gate.ts') as { createLinkedInOperationGate(): Gate };
// Explicit test composition only; providers are mandatory and no ENV/live defaults are selected.
export async function createSqlFeatureServices(db: ConsoleSql, grant: ConsoleWrites, providers: SqlFeatureProviders) {
  if (!grant.clientIds.size || !providers.auth || !providers.profile || !providers.comments || !providers.inviter || !providers.posts)
    throw new PostgresReadError('sql_feature_test_dependencies_required');
  const storage = createSqlLinkedInStorage(db, grant), gate = createLinkedInOperationGate();
  const repository = { ...storage.repository,
    async listAccounts() { return (await storage.repository.listAccounts()).filter(a => grant.clientIds.has(a.clientId)); },
    async getAccount(id: number, options?: { fresh?: boolean }) {
      const account = await storage.repository.getAccount(id, options);
      return account && grant.clientIds.has(account.clientId) ? account : undefined;
    }
  };
  const access = { accountIds: new Set((await repository.listAccounts()).map(a => a.platformAccountId)), create: grant.create };
  if (!access.accountIds.size) throw new PostgresReadError('sql_feature_test_account_required');
  const cv = createFeatureCv(db, repository, grant, providers.posts);
  // Resolve all storage contracts before constructing any service that restores jobs.
  const profileStore = createSqlProfileStore(db, access), commentStore = createSqlCommentStore(db, access);
  const inviterStore = createSqlInviterStore(db, access), postStore = createSqlPostStore(db, access);
  const profileFiller = createProfileFillerService({ repository, gate, store: profileStore,
    client: providers.profile.client, generationRuntime: providers.profile.runtime, generationRepository: cv.generationRepository,
    executorOptions: providers.profile.executorOptions });
  const connectionInviter = createConnectionInviterService({ ...providers.inviter, store: inviterStore, repository, gate,
    allowedAccounts: [...access.accountIds], writerEnabled: true, writerId: 'sql-test', autoRecover: false, enforceWriterSingleton: false });
  const postWriter = createPostWriterService({ ...providers.posts, source: cv.source, store: postStore, gate,
    writerId: 'sql-test', writable: true }, false);
  const commentMonitor = createCommentMonitorService({ ...providers.comments, repository, gate, store: commentStore,
    loggerFor: () => ({ event() {} }), autoStart: false });
  return { profileFiller, connectionInviter, postWriter, commentMonitor, linkedinOperationGate: gate,
    linkedinAuthRuns: createSqlAuthTestService(db, providers.auth, grant, gate),
    async close() { commentMonitor.stop?.(); connectionInviter.stop(); await postWriter.close(); }
  };
}
export type SqlFeatureServices = Awaited<ReturnType<typeof createSqlFeatureServices>>;
