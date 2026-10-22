import { randomUUID } from 'node:crypto';
import { acquireProcessLock, createValidatedFileStore } from '../../octo-access-test/store.mts';
import { createMemoryStore } from '../testing.mts';
import { OctoError } from '../contracts.mts';
import type { OctoStore } from '../contracts.mts';

const mutations = ['claimClientPassword', 'saveClientState', 'reserve', 'save', 'remove', 'recordPage', 'setCoverage'] as const;
type Mutation = typeof mutations[number];
type Command = { method: Mutation; args: unknown[] };
type Journal = { schema: 1; identity: string; runId: string; commands: Command[] };

// Test-only durable adapter for backend restart regressions; never used by the app.
export async function openLocalStore(path: string, identity: string, persist?: (journal: Journal) => Promise<void>) {
  const release = await acquireProcessLock(path);
  const validate = (value: unknown): Journal => {
    const j = value as Journal;
    if (!j || j.schema !== 1 || j.identity !== identity || !/^[a-f0-9-]{36}$/.test(j.runId) ||
      !Array.isArray(j.commands) || j.commands.some(c => !c || !mutations.includes(c.method) || !Array.isArray(c.args)))
      throw new OctoError('octo_local_state_invalid');
    return j;
  };
  try {
    const disk = createValidatedFileStore(path, validate);
    const journal = await disk.load() ?? { schema: 1 as const, identity, runId: randomUUID(), commands: [] };
    const base = createMemoryStore();
    const call = (method: keyof OctoStore, args: unknown[]) =>
      (base[method] as (...args: unknown[]) => Promise<unknown>).apply(base, structuredClone(args));
    try { for (const command of journal.commands) await call(command.method, command.args); }
    catch { throw new OctoError('octo_local_state_invalid'); }
    await disk.save(journal);
    let queue = Promise.resolve(), failed = false, closed = false, closing: Promise<void> | undefined;
    const serial = <T,>(action: () => Promise<T>): Promise<T> => {
      const work = queue.then(async () => {
        if (closed) throw new OctoError('octo_local_store_closed');
        if (failed) throw new OctoError('octo_local_persistence_failed');
        return action();
      });
      queue = work.then(() => {}, () => {});
      return work;
    };
    const store = {} as OctoStore;
    for (const method of Object.keys(base) as Array<keyof OctoStore>) {
      if (method === 'leader') continue;
      store[method] = ((...args: unknown[]) => {
        const copied = structuredClone(args);
        return serial(async () => {
          const result = await call(method, copied);
          if ((mutations as readonly string[]).includes(method)) {
            journal.commands.push({ method: method as Mutation, args: copied });
            try { await (persist ?? disk.save)(journal); }
            catch { failed = true; throw new OctoError('octo_local_persistence_failed'); }
          }
          return result;
        });
      }) as never;
    }
    store.leader = () => serial(async () => {
      const lease = await base.leader();
      return lease && { check: () => serial(() => lease.check()), release: () => lease.release() };
    });
    return { store, runId: journal.runId,
      close: () => closing ??= (async () => { await queue; closed = true; await release(); })() };
  } catch (error) { await release(); throw error; }
}
