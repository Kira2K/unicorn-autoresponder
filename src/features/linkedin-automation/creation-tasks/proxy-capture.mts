import type { CloudApi, OctoStore, OctoConfig, ManagedProfile } from '../../octo-access/contracts.mts';
import type { OctoService } from '../../octo-access/service.mts';
import { canEditProxy } from '../../octo-access/proxy-workflow.mts';
import { inFolder } from '../../octo-access/provision.mts';
import { IntakeError } from '../console-intake/contracts.mts';

/** Read the actual closed cloud profile. No proxy credentials enter a task or its response. */
export function createTaskProxyCapture(deps: { store: OctoStore; api: CloudApi; config: OctoConfig; octo: OctoService }) {
  async function idle(p: ManagedProfile) {
    if (!p.uuid || !canEditProxy(p)) throw new IntakeError('linkedin_task_close_profile_first', 409);
    const live = await deps.api.getProfile(p.uuid);
    if (live.status !== 0 || !inFolder(live, deps.config.homeFolder) || live.title !== p.original.title ||
      live.description !== p.original.description) throw new IntakeError('linkedin_task_close_profile_first', 409);
    return live;
  }
  return async (p: ManagedProfile) => {
    await idle(p);
    if (!deps.api.readProfileProxy) throw new IntakeError('linkedin_task_proxy_capture_unavailable', 503);
    const actual = await deps.api.readProfileProxy(p.uuid!);
    if (actual.inline) {
      // Reuse the durable proxy workflow: unknown create/attach outcomes are reconciled by its operation marker.
      await deps.octo.queueProxy(p.clientId, p.id, actual.inline);
      throw new IntakeError('linkedin_task_proxy_pending', 409);
    }
    const proxy = actual.saved;
    if (!proxy || proxy.profiles_count !== 1) throw new IntakeError('linkedin_task_proxy_shared_or_missing', 409);
    const before = await deps.store.get(p.id);
    if (!before || before.revision !== p.revision) throw new IntakeError('linkedin_task_proxy_changed', 409);
    const live = await idle(before);
    if (live.proxy?.uuid !== proxy.uuid) throw new IntakeError('linkedin_task_proxy_changed', 409);
    const saved = await deps.store.save({ ...before, proxy: { uuid: proxy.uuid, title: proxy.title, type: proxy.type, host: proxy.host, port: proxy.port } });
    if ((await idle(saved)).proxy?.uuid !== proxy.uuid) throw new IntakeError('linkedin_task_proxy_changed',409);
    return saved;
  };
}
