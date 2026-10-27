import { fail } from './settings.mjs';

// Stop admission without forgetting an already-dispatched password mutation.
// The original agent classifies an aborted write as uncertain and saves it.
export function createDrainingFetch(backendUrl, fetchImpl = fetch, { graceMs = 18_000, ackMs = 3_000 } = {}) {
  let stopping = false, timer;
  const active = new Map();
  const isAck = (url, init) => url.origin === new URL(backendUrl).origin
    && url.pathname === '/internal/octo-bridge/v1/result' && init?.method === 'POST';
  return {
    async fetch(input, init = {}) {
      const ack = isAck(new URL(String(input)), init);
      if (stopping && !ack) throw fail('bridge_render_stopping');
      const controller = new AbortController();
      const signals = [controller.signal, ...(init.signal ? [init.signal] : [])];
      if (ack && stopping) signals.push(AbortSignal.timeout(ackMs));
      active.set(controller, ack);
      const release = () => active.delete(controller);
      try {
        const response = await fetchImpl(input, { ...init, signal: AbortSignal.any(signals) });
        // Keep the abort controller until the body is consumed, not only until headers arrive.
        return { ok: response.ok, status: response.status,
          async json() { try { return await response.json(); } finally { release(); } } };
      } catch (e) { release(); throw e; }
    },
    stop() {
      if (stopping) return;
      stopping = true;
      timer = setTimeout(() => {
        for (const controller of active.keys()) controller.abort();
      }, graceMs);
    },
    dispose() { clearTimeout(timer); for (const controller of active.keys()) controller.abort(); active.clear(); },
  };
}
