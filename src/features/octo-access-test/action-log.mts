import WebSocket from 'ws';
import { TestError } from './contract.mts';

const ENDPOINT = 'wss://app.octobrowser.net/api/v2/automation/ws/action_log';
const MAX_PAGE_ITEMS = 100;
const ACTIONS = new Set(['profiles.started', 'profiles.stopped', 'profiles.force_stopped']);
export interface Cursor { uuid: string; time: number }
export interface ActionEvent { id: string; profileId: string; action: string; time: number; title?: string }
export interface ActionPage { events: ActionEvent[]; watermark: Cursor }
export interface SocketLike {
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  close(): void;
  readyState?: number;
}
export interface ActionLogOptions {
  token: string;
  profileIds: string[];
  loadCursor: () => Cursor | undefined;
  onPage: (page: ActionPage) => Promise<void>;
  connect?: (url: string, options: { headers: Record<string, string>; followRedirects: false; handshakeTimeout: number }) => SocketLike;
  now?: () => number;
  reconnectMs?: number;
  includeUpdates?: boolean;
  requireCompleteHistory?: boolean;
  onReplayGap?: (coverageSince: number) => Promise<void>;
}

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const validCursor = (v: unknown): v is Cursor => object(v) && typeof v.uuid === 'string' && !!v.uuid && Number.isFinite(v.time);
const safeError = (code: string) => code.slice(0, 80).replace(/[^a-z0-9_.-]/gi, '_');

export function createActionLogListener(options: ActionLogOptions) {
  if (!options.token.trim()) throw new TestError('OCTO_API_TOKEN_missing', 500);
  const profileIds = new Set(options.profileIds.map(id => id.replaceAll('-', '').toLowerCase()));
  const actions = new Set(ACTIONS);
  if (options.includeUpdates) actions.add('profiles.updated');
  const now = options.now ?? Date.now;
  const connect = options.connect ?? ((url, opts) => new WebSocket(url, opts) as unknown as SocketLike);
  const reconnectMs = Math.max(100, Math.min(60_000, options.reconnectMs ?? 1_000));
  let socket: SocketLike | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let started = false, stopping = false, connected = false, reconnects = 0, attempts = 0;
  let checkpoint = 0;
  let lastSafeError: string | undefined, queue: ActionPage[] = [], draining = false;
  let stoppedResolve: (() => void) | undefined;
  const stopped = new Promise<void>(resolve => { stoppedResolve = resolve; });
  const schedule = () => {
    if (stopping || !started || timer) return;
    reconnects++;
    const delay = Math.min(30_000, reconnectMs * 2 ** Math.min(attempts++, 5));
    timer = setTimeout(() => { timer = undefined; open(); }, Math.round(delay * (0.8 + Math.random() * 0.4)));
  };
  const disconnected = (error?: string) => {
    checkpoint++;
    if (error) lastSafeError = safeError(error);
    connected = false;
    if (socket) { const old = socket; socket = undefined; try { old.close(); } catch {} }
    schedule();
  };
  const open = async () => {
    if (stopping || !started) return;
    let url = ENDPOINT;
    let cursor: Cursor | undefined;
    try { cursor = options.loadCursor(); } catch { lastSafeError = 'cursor_load_failed'; schedule(); return; }
    if (validCursor(cursor) && cursor.time >= Math.floor(now() / 1000) - 86_400) {
      url += `?after_uuid=${encodeURIComponent(cursor.uuid)}`;
    } else {
      const since = Math.floor(now() / 1000) - 86_400 + 60;
      try { if (options.onReplayGap) await options.onReplayGap(since * 1000); }
      catch { lastSafeError = 'coverage_save_failed'; schedule(); return; }
      if (stopping) return;
      url += `?from_timestamp=${since}`;
    }
    try {
      const ws = connect(url, { headers: { 'X-Octo-Api-Token': options.token }, followRedirects: false, handshakeTimeout: 10_000 });
      socket = ws;
      ws.on('open', () => { if (socket !== ws || stopping) return; checkpoint++; connected = true; attempts = 0; lastSafeError = undefined; });
      ws.on('message', (data: unknown) => {
        if (socket !== ws || stopping) return;
        checkpoint++;
        const invalid = () => { lastSafeError = 'invalid_stream_page'; if (options.requireCompleteHistory) disconnected(lastSafeError); };
        let raw: unknown;
        try { raw = JSON.parse(typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data)); }
        catch { invalid(); return; }
        if (!object(raw) || !Array.isArray(raw.items) || raw.items.length > MAX_PAGE_ITEMS || !validCursor(raw.watermark)) { invalid(); return; }
        const events: ActionEvent[] = [];
        for (const item of raw.items) {
          if (options.requireCompleteHistory) {
            if (!object(item) || typeof item.action !== 'string') { invalid(); return; }
            if (actions.has(item.action) && (typeof item.object_id !== 'string' || !item.object_id ||
              (profileIds.has(item.object_id.replaceAll('-', '').toLowerCase()) &&
                (typeof item.uuid !== 'string' || !item.uuid || !Number.isFinite(item.time))))) { invalid(); return; }
          }
          if (!object(item) || typeof item.uuid !== 'string' || !item.uuid || typeof item.action !== 'string'
            || !actions.has(item.action) || typeof item.object_id !== 'string' || !item.object_id || !Number.isFinite(item.time)) continue;
          const profileId = item.object_id;
          if (profileIds.has(profileId.replaceAll('-', '').toLowerCase())) events.push({ id: item.uuid, profileId, action: item.action, time: item.time,
            ...(options.includeUpdates && typeof item.object_title === 'string' ? { title: item.object_title.slice(0, 90) } : {}) });
        }
        queue.push({ events, watermark: { uuid: raw.watermark.uuid, time: raw.watermark.time } });
        void drain();
      });
      ws.on('unexpected-response', (_req: unknown, res: { statusCode?: number }) => { if (socket === ws) disconnected(`http_${res.statusCode ?? 'error'}`); });
      ws.on('error', () => { if (socket === ws) disconnected('websocket_error'); });
      ws.on('close', () => { if (socket === ws) disconnected('websocket_closed'); });
    } catch { disconnected('websocket_connect_failed'); }
  };
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (queue.length && !stopping) {
        const page = queue[0];
        try { await options.onPage(page); }
        catch { queue = []; disconnected('page_callback_failed'); break; }
        queue.shift();
      }
    } finally { draining = false; if (stopping && !queue.length) stoppedResolve?.(); }
  };
  return {
    start() { if (started || stopping) return; started = true; open(); },
    async stop() {
      if (stopping) return stopped;
      checkpoint++;
      stopping = true; started = false; connected = false;
      if (timer) clearTimeout(timer); timer = undefined;
      queue = [];
      if (socket) { const ws = socket; socket = undefined; try { ws.close(); } catch {} }
      if (!draining) stoppedResolve?.();
      await stopped;
    },
    // A stable checkpoint proves no page/disconnect arrived across asynchronous
    // evidence reads. An outstanding persistence callback invalidates the proof.
    status() { return { connected, reconnects, lastSafeError,
      checkpoint: connected && !queue.length && !draining ? checkpoint : undefined }; }
  };
}
