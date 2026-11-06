export type Candidate = { id: string; username: string };
export type Store = {
  pending(after: string): Promise<string[]>;
  get(id: string): Promise<Candidate | undefined>;
  save(row: Candidate, telegramId: string): Promise<boolean>;
};
type Report = (event: { code: string; clientId?: string }) => void;

export function normalizeUsername(value: string): string | undefined {
  const name = value.trim().replace(/^(?:https?:\/\/)?(?:www\.)?t\.me\//i, '').replace(/^@/, '').replace(/\/$/, '');
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name.toLowerCase() : undefined;
}

/** Event-driven only. Pending work is derived from existing client rows after reconnect. */
export function createClientIdRuntime(input: {
  store: Store;
  subscribe(onId: (id: string) => void, onLost: () => void): Promise<() => Promise<void>>;
  resolve(username: string): Promise<string>;
  report: Report;
  retryMs?: number;
  spacingMs?: number;
}) {
  const pending = new Map<string, { due: number; attempts: number }>();
  const retryMs = input.retryMs ?? 1500, spacingMs = input.spacingMs ?? 250;
  let stopped = false, started = false, connected = false, nextLookupAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => Promise<void>) | undefined, connecting: Promise<void> | undefined, work: Promise<void> | undefined;
  const report: Report = event => { try { input.report(event); } catch { /* reporting must not stop resolution */ } };

  function enqueue(id: string) {
    if (stopped || !/^[1-9]\d*$/.test(id)) return;
    pending.set(id, { due: 0, attempts: 0 });
    wake();
  }
  function wake() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (stopped || !connected || work || !pending.size) return;
    const [id, job] = [...pending].sort((a, b) => a[1].due - b[1].due)[0];
    const delay = Math.max(job.due, nextLookupAt) - Date.now();
    if (delay > 0) { timer = setTimeout(wake, Math.min(delay, 2147483647)); timer.unref?.(); return; }
    pending.delete(id);
    work = processOne(id, job.attempts).finally(() => { work = undefined; wake(); });
  }
  async function processOne(id: string, attempts: number) {
    try {
      const row = await input.store.get(id);
      if (!row || stopped) return;
      const username = normalizeUsername(row.username);
      if (!username) { report({ clientId: id, code: 'invalid_username' }); return; }
      const telegramId = await input.resolve(username);
      if (stopped) return;
      if (!/^[1-9]\d*$/.test(telegramId)) throw Object.assign(Error(), { code: 'not_user' });
      const saved = await input.store.save(row, telegramId);
      report({ clientId: id, code: saved ? 'saved' : 'stale' });
      if (!saved && !stopped && !pending.has(id)) pending.set(id, { due: 0, attempts: 0 });
    } catch (error) {
      const e = error as { code?: string; retryAfterMs?: number };
      const permanent = ['not_found', 'not_user', 'invalid_username'].includes(e?.code ?? '');
      report({ clientId: id, code: permanent || ['session_required', 'timeout'].includes(e?.code ?? '') ? e.code! : 'retry' });
      if (!permanent && !stopped) {
        const delay = Math.max(Math.min(retryMs * 2 ** Math.min(attempts, 5), 30000), Number(e?.retryAfterMs) || 0);
        nextLookupAt = Math.max(nextLookupAt, Date.now() + delay);
        if (!pending.has(id)) pending.set(id, { due: Date.now() + delay, attempts: attempts + 1 });
      }
    } finally { nextLookupAt = Math.max(nextLookupAt, Date.now() + spacingMs); }
  }
  function lost() {
    if (stopped) return;
    connected = false;
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (!reconnect) {
      reconnect = setTimeout(() => { reconnect = undefined; void connect(); }, retryMs);
      reconnect.unref?.();
    }
  }
  function connect(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        await unsubscribe?.(); unsubscribe = undefined;
        let disconnected = false;
        const close = await input.subscribe(enqueue, () => { disconnected = true; lost(); });
        if (stopped) { await close(); return; }
        unsubscribe = close;
        // LISTEN must be committed before the recovery scan to close the startup race.
        let after = '0';
        for (;;) {
          const ids = await input.store.pending(after);
          if (stopped) return;
          for (const id of ids) enqueue(id);
          if (!ids.length) break;
          after = ids[ids.length - 1];
        }
        if (disconnected) throw Error('listener_disconnected');
        connected = true;
        report({ code: 'listening' });
        wake();
      } catch {
        report({ code: 'listener_retry' });
        lost();
      }
    })().finally(() => { connecting = undefined; });
    return connecting;
  }
  return {
    async start() { if (started || stopped) return; started = true; await connect(); },
    async stop() {
      stopped = true; connected = false;
      if (timer) clearTimeout(timer);
      if (reconnect) clearTimeout(reconnect);
      pending.clear();
      await connecting;
      await unsubscribe?.(); unsubscribe = undefined;
      await work;
    }
  };
}
