import type { CreationTaskStore } from './postgres-store.mts';
import type { OctoStore, ManagedProfile } from '../../octo-access/contracts.mts';
import type { OctoService } from '../../octo-access/service.mts';
import type { WebClient } from '../../web-console/backend/types.ts';
import { IntakeError } from '../console-intake/contracts.mts';
import { taskId } from './contracts.mts';
import type { StatusNotification, TaskStatusChange } from './status-report.mts';
import type {createNewTaskProxy} from './new-proxy-service.mts';

export function createCreationTaskService(deps: {
  store: CreationTaskStore; profiles: Pick<OctoStore,'list'|'get'>; octo: OctoService;
  client(id: number): Promise<WebClient>;
  secrets(clientId: number, accountId: number): Promise<unknown>;
  capture(profile: ManagedProfile): Promise<ManagedProfile>;
  nodeMavenKey(): string;
  newProxy?:ReturnType<typeof createNewTaskProxy>;
  reportStatusChange?(change: TaskStatusChange): Promise<StatusNotification>;
}) {
  const detail = async (id: unknown) => deps.store.detail(taskId(id));
  async function en(id: unknown) {
    const d = await detail(id), rows = (await deps.profiles.list(d.task.clientId)).filter(p => p.locale === 'en' && !p.deletion);
    if (rows.length !== 1) throw new IntakeError('linkedin_task_en_profile_required', 409);
    return { ...d, profile: rows[0] };
  }
  async function requireNewProxy(d:Awaited<ReturnType<typeof en>>){
    if(d.task.requiresNewProxy){if(!deps.newProxy)throw new IntakeError('linkedin_task_new_proxy_required',503);await deps.newProxy.assert(d.task,d.profile);}
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
    async profileStatus(id: unknown, proxyCredentials = false) {
      const d = await detail(id), s = await deps.octo.status(d.task.clientId, { proxyCredentials, locales: ['en'] });
      let newProxyReady=!d.task.requiresNewProxy;
      if(d.task.requiresNewProxy&&deps.newProxy){const p=(await deps.profiles.list(d.task.clientId)).find(p=>p.locale==='en');newProxyReady=!!p&&await deps.newProxy.ready(d.task,p);}
      return { ...s,newProxyRequired:!!d.task.requiresNewProxy,newProxyReady,
        profiles: s.profiles.filter(p => p.locale === 'en').map(p=>({...p,canAcquire:newProxyReady&&p.canAcquire})), requiredLocales: ['en'] };
    },
    async acquire(id: unknown, profileId: unknown) {
      const d = await en(id);
      if (taskId(profileId) !== d.profile.id) throw new IntakeError('forbidden',403);
      await requireNewProxy(d);
      return deps.octo.acquire(d.task.clientId, d.profile.id);
    },
    async saveProxy(id: unknown, profileId: unknown, input: unknown) {
      const d = await en(id);
      if (taskId(profileId) !== d.profile.id) throw new IntakeError('forbidden',403);
      if(d.task.requiresNewProxy){
        if(!deps.newProxy)throw new IntakeError('linkedin_task_new_proxy_required',503);
        await deps.newProxy.queue(d.task,d.profile,input);
      }else await deps.octo.saveProxy(d.task.clientId, d.profile.id, input);
      return { queued: true,...(d.task.requiresNewProxy?{task:(await detail(id)).task}:{}) };
    },
    async grant(id: unknown, grantId: string) {
      const d = await en(id);
      if (d.profile.grant?.id !== grantId) throw new IntakeError('forbidden',403);
      await requireNewProxy(d);
      return deps.octo.grant(d.task.clientId, grantId);
    },
    async result(id: unknown, body: Record<string, unknown>) { return deps.store.result(taskId(id), taskId(body.version), body); },
    async status(id: unknown, body: Record<string, unknown>) {
      const before = await detail(id), previousStatus = before.task.status;
      if (body.status === 'сделана экспертом' && previousStatus !== body.status) {
        const d = await en(id);
        if (d.task.version !== taskId(body.version)) throw new IntakeError('linkedin_task_stale_version',409);
        await requireNewProxy(d);
        if (!d.task.proxySavedAt || !d.task.proxyUuid || !d.task.proxyProfileId) throw new IntakeError('linkedin_task_proxy_required',409);
        // Re-read the cloud proxy at completion too; a changed proxy invalidates the old receipt.
        const p = await deps.capture(d.profile);
        if (!d.task.proxySavedAt || p.proxy?.uuid !== d.task.proxyUuid || p.id !== d.task.proxyProfileId)
          throw new IntakeError('linkedin_task_proxy_required',409);
      }
      const task = await deps.store.status(taskId(id), taskId(body.version), body.status);
      if (task.status === previousStatus || !deps.reportStatusChange) return task;
      let notification: StatusNotification;
      try {
        notification = await deps.reportStatusChange({ taskId:task.id,clientId:task.clientId,from:previousStatus,to:task.status });
      } catch { notification = {outcome:'uncertain',code:'notification_internal'}; }
      return { ...task, notification };
    },
    async capture(id: unknown, body: Record<string, unknown>) {
      const d = await en(id);
      if (d.task.version !== taskId(body.version)) throw new IntakeError('linkedin_task_stale_version',409);
      await requireNewProxy(d);
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
