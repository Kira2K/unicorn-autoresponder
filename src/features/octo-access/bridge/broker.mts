import { OctoError } from '../contracts.mts';
import type { CloudApi, Grant, ManagedProfile, OctoConfig, OctoStore } from '../contracts.mts';
import { inFolder } from '../provision.mts';
import { cleanupHistoryReady, sameMetadata } from '../cleanup-readiness.mts';
export interface BridgeIdentity { id: string; ownerEmail: string }
export interface BridgeTask {
  version: 1; bridgeId: string; id: string; uuid: string; password: string; ownerEmail: string; expiresAt: number; hiddenAt: number;
}
type Receipt = { state: 'succeeded' | 'uncertain' | 'rejected'; code?: string };
export function createBridgeBroker({ store, api, config, bridge, checkpoint, now = Date.now }: {
  store: OctoStore; api: CloudApi; config: OctoConfig; bridge: BridgeIdentity;
  checkpoint(): Promise<string | number | undefined>; now?: () => number;
}) {
  const device = (id: string) => { if (!/^[a-f0-9]{64}$/.test(id)) throw new OctoError('octo_bridge_invalid_device', 400); };
  const check = async () => { const c = await checkpoint(); if (c === undefined) throw new OctoError('octo_bridge_unavailable', 503); return c; };
  const relevant = (p: ManagedProfile) => p.uuid && p.grant?.clearMethod === 'bridge' && p.grant.bridgeClear?.bridgeId === bridge.id
    && p.grant.bridgeClear.ownerEmail === bridge.ownerEmail && !p.deletion;
  const find = async (id: string) => {
    const p = (await store.list()).find(p => relevant(p) && p.grant!.id === id);
    if (!p) throw new OctoError('octo_bridge_task_not_found', 404); return p;
  };
  const task = (p: ManagedProfile): BridgeTask => ({ version: 1, bridgeId: bridge.id, id: p.grant!.id, uuid: p.uuid!, password: p.password,
    ownerEmail: p.grant!.bridgeClear!.ownerEmail, expiresAt: p.grant!.expiresAt!, hiddenAt: p.grant!.hiddenAt! });
  async function eligible(p: ManagedProfile) {
    const g = p.grant!;
    if (g.phase !== 'awaiting_close' || g.pending !== 'clear' || g.bridgeClear!.result ||
      !Number.isFinite(g.expiresAt) || !Number.isFinite(g.hiddenAt) || now() < g.expiresAt! || g.hiddenAt! < g.expiresAt!)
      throw new OctoError('octo_bridge_task_not_ready', 409);
    const c = await check(), live = await api.getProfile(p.uuid!);
    if (live.uuid.replaceAll('-', '') !== p.uuid!.replaceAll('-', '') || live.status !== 0 || !live.has_user_password ||
      !inFolder(live, config.homeFolder) || !sameMetadata(live, g.original) || !await cleanupHistoryReady(p, store))
      throw new OctoError('octo_bridge_task_not_ready', 409);
    if (await check() !== c) throw new OctoError('octo_event_history_pending', 409);
  }
  return {
    async health() { await check(); return { ready: true, bridgeId: bridge.id }; },
    async poll(deviceId: string, profileUuids?: string[]): Promise<BridgeTask | null> {
      device(deviceId); await check();
      if (profileUuids !== undefined && (!Array.isArray(profileUuids) || !profileUuids.length || profileUuids.length > 1000 ||
        !profileUuids.every(id => /^[a-f0-9]{32}$/.test(id)))) throw new OctoError('octo_bridge_invalid_scope', 400);
      for (const p of await store.list()) {
        if (!relevant(p) || p.grant!.phase !== 'awaiting_close' || p.grant!.pending !== 'clear' || p.grant!.bridgeClear!.result) continue;
        if (profileUuids && !profileUuids.includes(p.uuid!)) continue;
        const state = p.grant!.bridgeClear!;
        if (state.claim && state.claim.deviceId !== deviceId) continue;
        if (state.claim?.authorizedAt === undefined) {
          try { await eligible(p); }
          catch (error) {
            const code = (error as { code?: string }).code;
            if (code === 'octo_force_stop_observed' || code === 'octo_event_history_gap') {
              p.grant!.phase = 'blocked'; p.grant!.error = code; await check(); await store.save(p); continue;
            }
            if (code === 'octo_bridge_task_not_ready' || code === 'octo_event_history_pending') continue;
            throw error;
          }
        }
        if (!state.claim) { state.claim = { deviceId }; await check(); await store.save(p); }
        return task(p);
      }
      return null;
    },
    async authorize(deviceId: string, id: string) {
      device(deviceId); const p = await find(id), state = p.grant!.bridgeClear!;
      if (state.claim?.deviceId !== deviceId) throw new OctoError('octo_bridge_claim_mismatch', 409);
      if (state.claim.authorizedAt !== undefined) throw new OctoError('octo_bridge_already_authorized', 409);
      await eligible(p); state.claim.authorizedAt = now(); await check(); await store.save(p);
      return { authorized: true };
    },
    async result(deviceId: string, id: string, receipt: Receipt) {
      device(deviceId);
      if (!receipt || !['succeeded','uncertain','rejected'].includes(receipt.state) || receipt.code !== undefined &&
        !/^bridge_[a-z0-9_]{1,80}$/.test(receipt.code)) throw new OctoError('octo_bridge_invalid_result', 400);
      await check(); const p = await find(id), state = p.grant!.bridgeClear!;
      if (state.claim?.deviceId !== deviceId || state.claim.authorizedAt === undefined && receipt.state !== 'uncertain')
        throw new OctoError('octo_bridge_claim_mismatch', 409);
      if (state.result) {
        if (state.result.state !== receipt.state || state.result.code !== receipt.code) throw new OctoError('octo_bridge_result_conflict', 409);
        return { accepted: true };
      }
      state.result = { state: receipt.state, ...(receipt.code ? { code: receipt.code } : {}), at: now() };
      await check(); await store.save(p); return { accepted: true };
    }
  };
}
