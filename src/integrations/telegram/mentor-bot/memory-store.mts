import type { State, Store } from './types.mts';
import { assertStateMutation } from './state-contract.mts';
/** Serializable mock adapter. A thrown callback never publishes partial data. */
export function memoryStore(initial: State): Store & { snapshot(): State } {
  let data = structuredClone(initial), tail = Promise.resolve();
  return {
    snapshot: () => structuredClone(data),
    async transaction<T>(operation: (state: State) => T): Promise<T> {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try {
        const draft = structuredClone(data);
        const result = operation(draft);
        if (result && typeof (result as {then?: unknown}).then === 'function') throw new Error('mentor_async_transaction_forbidden');
        assertStateMutation(data,draft);
        data = draft;
        return structuredClone(result);
      } finally { release(); }
    }
  };
}
