import { createRequire } from 'node:module';

type Client = { invoke(request: unknown): Promise<any>; disconnect(): Promise<unknown> };
type Dependencies = { open(): Promise<Client>; lookup(client: Client, username: string): Promise<any> };
const require = createRequire(import.meta.url);
const defaults: Dependencies = {
  open: () => require('../../integrations/telegram/messenger.ts').createTelegramClient({ interactive: false, saveSession: false }),
  lookup: (client, username) => client.invoke(new (require('telegram').Api.contacts.ResolveUsername)({ username }))
};

export function classifyLookupError(error: unknown) {
  const e = error as { errorMessage?: string; message?: string; code?: string | number; seconds?: number };
  const message = String(e?.errorMessage ?? e?.message ?? '');
  if (e?.code === 'telegram_session_required' || /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/.test(message))
    return { code: 'session_required' };
  if (message === 'lookup_timeout') return { code: 'timeout' };
  if (/USERNAME_NOT_OCCUPIED|USERNAME_NOT_FOUND/.test(message)) return { code: 'not_found' };
  if (/USERNAME_INVALID/.test(message)) return { code: 'invalid_username' };
  if (e?.code === 'not_user') return { code: 'not_user' };
  const wait = /FLOOD(?:_PREMIUM)?_WAIT_(\d+)/.exec(message);
  return { code: 'temporary', retryAfterMs: Math.max(0, Number(wait?.[1] ?? e?.seconds) || 0) * 1000 };
}

/** Reuses the reporting session; never logs in interactively, saves a session, or sends messages. */
export function createTelegramIdResolver(deps: Dependencies = defaults, timeoutMs = 20000) {
  let opening: Promise<Client> | undefined, client: Client | undefined, stopped = false, generation = 0;
  async function disconnect() {
    generation++;
    const previous = client; client = undefined; opening = undefined;
    await previous?.disconnect().catch(() => {});
  }
  async function getClient() {
    if (stopped) throw Error('stopped');
    if (!opening) {
      const current = generation;
      opening = deps.open().then(async created => {
        if (stopped || current !== generation) { await created.disconnect(); throw Error('stopped'); }
        client = created; return created;
      }).catch(error => { if (current === generation) opening = undefined; throw error; });
    }
    return opening;
  }
  return {
    async resolve(username: string): Promise<string> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          getClient().then(c => deps.lookup(c, username)),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('lookup_timeout')), timeoutMs); })
        ]);
        const id = String(result?.peer?.userId ?? '');
        const user = result?.users?.find((u: any) => String(u.id) === id);
        if (result?.peer?.className !== 'PeerUser' || !/^[1-9]\d*$/.test(id) || user?.className !== 'User' || user.bot || user.deleted)
          throw Object.assign(Error(), { code: 'not_user' });
        return id;
      } catch (error) {
        const classified = classifyLookupError(error);
        if (['temporary', 'timeout', 'session_required'].includes(classified.code) && !classified.retryAfterMs) await disconnect();
        throw Object.assign(new Error(classified.code), classified);
      } finally { if (timer) clearTimeout(timer); }
    },
    async close() { stopped = true; await disconnect(); }
  };
}
