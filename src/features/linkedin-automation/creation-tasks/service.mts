import type { CreationTaskStore } from './postgres-store.mts';
import type { OctoStore, ManagedProfile } from '../../octo-access/contracts.mts';
import type { OctoService } from '../../octo-access/service.mts';
import type { WebClient } from '../../web-console/backend/types.ts';
import { IntakeError } from '../console-intake/contracts.mts';
import { taskId } from './contracts.mts';

export function createCreationTaskService(deps: {
  store: CreationTaskStore; profiles: Pick<OctoStore,'list'|'get'>; octo: OctoService;
  client(id: number): Promise<WebClient>;
  secrets(clientId: number, accountId: number): Promise<unknown>;
  capture(profile: ManagedProfile): Promise<ManagedProfile>;
  nodeMavenKey(): string;
}) {
  const detail = async (id: unknown) => deps.store.detail(taskId(id));
  async function en(id: unknown) {
    const d = await detail(id), rows = (await deps.profiles.list(d.task.clientId)).filter(p => p.locale === 'en' && !p.deletion);
    if (rows.length !== 1) throw new IntakeError('linkedin_task_en_profile_required', 409);
    return { ...d, profile: rows[0] };
  }
  return {
    async list() {
      return Promise.all((await deps.store.list()).map(async task => {
        const c = await deps.client(task.clientId);
        return { ...task, fio: c.fio || c.clientName, stack: c.primaryStack };
      }));
    },
    async detail(id: unknown) {
      const d = await detail(id), c = await deps.client(d.task.clientId);
      return { ...d, client: { id: c.id, fio: c.fio || c.clientName, stack: c.primaryStack } };
    },
    async secrets(id: unknown, kind: unknown) {
      const d = await detail(id);
      if (!['outlook','linkedin'].includes(String(kind))) throw new IntakeError('linkedin_task_invalid_account');
      return deps.secrets(d.task.clientId, kind === 'outlook' ? d.task.outlookAccountId : d.task.linkedinAccountId);
    },
    async profileStatus(id: unknown) {
      const d = await detail(id), s = await deps.octo.status(d.task.clientId);
      return { ...s, profiles: s.profiles.filter(p => p.locale === 'en'), requiredLocales: ['en'] };
    },
    async acquire(id: unknown, profileId: unknown) {
      const d = await en(id);
      if (taskId(profileId) !== d.profile.id) throw new IntakeError('forbidden',403);
      return deps.octo.acquire(d.task.clientId, d.profile.id);
    },
    async saveProxy(id: unknown, profileId: unknown, input: unknown) {
      const d = await en(id);
      if (taskId(profileId) !== d.profile.id) throw new IntakeError('forbidden',403);
      await deps.octo.saveProxy(d.task.clientId, d.profile.id, input);
      return { queued: true };
    },
    async grant(id: unknown, grantId: string) {
      const d = await en(id);
      if (d.profile.grant?.id !== grantId) throw new IntakeError('forbidden',403);
      return deps.octo.grant(d.task.clientId, grantId);
    },
    async result(id: unknown, body: Record<string, unknown>) { return deps.store.result(taskId(id), taskId(body.version), body); },
    async status(id: unknown, body: Record<string, unknown>) {
      if (body.status === 'сделана экспертом') {
        const d = await en(id);
        if (d.task.version !== taskId(body.version)) throw new IntakeError('linkedin_task_stale_version',409);
        if (!d.task.proxySavedAt || !d.task.proxyUuid || !d.task.proxyProfileId) throw new IntakeError('linkedin_task_proxy_required',409);
        // Re-read the cloud proxy at completion too; a changed proxy invalidates the old receipt.
        const p = await deps.capture(d.profile);
        if (!d.task.proxySavedAt || p.proxy?.uuid !== d.task.proxyUuid || p.id !== d.task.proxyProfileId)
          throw new IntakeError('linkedin_task_proxy_required',409);
      }
      return deps.store.status(taskId(id), taskId(body.version), body.status);
    },
    async capture(id: unknown, body: Record<string, unknown>) {
      const d = await en(id);
      if (d.task.version !== taskId(body.version)) throw new IntakeError('linkedin_task_stale_version',409);
      const p = await deps.capture(d.profile);
      if (!p.proxy) throw new IntakeError('linkedin_task_proxy_required',409);
      return deps.store.receipt(d.task.id, d.task.version, p.id, p.proxy.uuid, p.revision);
    },
    key() {
      const key = deps.nodeMavenKey();
      if (!key) throw new IntakeError('linkedin_task_nodemaven_unavailable',503);
      return { key };
    }
  };
}
export type CreationTaskService = ReturnType<typeof createCreationTaskService>;
