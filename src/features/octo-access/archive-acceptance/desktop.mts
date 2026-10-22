import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { ARCHIVE_ORIGIN, ArchiveFailure, requireCheck } from './contract.mts';
import type { Marker } from './contract.mts';
export function createAcceptanceDesktop(fetchImpl: typeof fetch = fetch) {
  const attempted = new Set<string>(), stopSent = new Set<string>();
  const pages = new Map<string, Page>(), connections = new Map<string, Browser>();
  async function request(path: string, method = 'GET', body?: object) {
    let response: Response;
    try { response = await fetchImpl(`http://127.0.0.1:58888${path}`, { method, redirect: 'error',
      signal: AbortSignal.timeout(55_000), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }); }
    catch { throw new ArchiveFailure('archive_desktop_outcome_unknown'); }
    let data: any;
    try { data = await response.json(); } catch { throw new ArchiveFailure('archive_desktop_response_invalid'); }
    if (!response.ok || data?.error || data?.error_code || data?.success === false) {
      const error = new ArchiveFailure('archive_desktop_request_failed') as ArchiveFailure & { details: object };
      error.details = { httpStatus: response.status, upstreamCode: data?.code }; throw error;
    }
    return data;
  }
  const active = async (): Promise<string[]> => {
    const data = await request('/api/profiles/active');
    requireCheck(Array.isArray(data) && data.every(p => typeof p.uuid === 'string'), 'archive_active_invalid');
    return data.map(p => p.uuid.replaceAll('-', '').toLowerCase());
  };
  async function pageFor(uuid: string) {
    const page = pages.get(uuid); requireCheck(page && !page.isClosed(), 'archive_browser_not_running'); return page;
  }
  return {
    active,
    async username(): Promise<string> {
      const data = await request('/api/username'); requireCheck(typeof data?.username === 'string', 'archive_username_invalid');
      return data.username.toLowerCase();
    },
    async start(uuid: string) {
      requireCheck(/^[a-f0-9]{32}$/.test(uuid) && !attempted.has(uuid), 'archive_duplicate_start');
      attempted.add(uuid);
      const result = await request('/api/profiles/start', 'POST', { uuid, headless: false, debug_port: true, only_local: true,
        timeout: 50 });
      requireCheck(result.uuid === uuid && result.state === 'STARTED' &&
        Number.isInteger(Number(result.debug_port)) && Number(result.debug_port) > 0 && Number(result.debug_port) <= 65535,
      'archive_start_invalid');
      return Number(result.debug_port);
    },
    async connect(uuid: string, port: number) {
      requireCheck(attempted.has(uuid), 'archive_unscoped_connect');
      const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      connections.set(uuid, connection);
      const context = connection.contexts()[0]; requireCheck(context, 'archive_context_missing');
      const page = context.pages()[0] ?? await context.newPage();
      await page.goto(ARCHIVE_ORIGIN, { waitUntil: 'domcontentloaded', timeout: 45_000 }); pages.set(uuid, page);
    },
    async matches(uuid: string, marker: Marker) {
      const page = await pageFor(uuid);
      const value = await page.evaluate(key => localStorage.getItem(key), marker.key);
      const cookies = await page.context().cookies(marker.origin);
      return value === marker.value && cookies.some(c => c.name === marker.cookie && c.value === marker.value);
    },
    async stop(uuid: string) {
      requireCheck(attempted.has(uuid), 'archive_unscoped_stop');
      requireCheck(!stopSent.has(uuid), 'archive_stop_outcome_unknown');
      if ((await active()).includes(uuid)) {
        stopSent.add(uuid); await request('/api/profiles/stop', 'POST', { uuid });
        const deadline = Date.now() + 90_000;
        while ((await active()).includes(uuid)) {
          requireCheck(Date.now() < deadline, 'archive_stop_timeout'); await new Promise(done => setTimeout(done, 500));
        }
      }
      attempted.delete(uuid); stopSent.delete(uuid); pages.delete(uuid);
      // Disconnect only after the ordinary stop has completed; never close an active remote browser through CDP.
      await connections.get(uuid)?.close().catch(() => {}); connections.delete(uuid);
    },
    attempted: () => [...attempted]
  };
}
export type AcceptanceDesktop = ReturnType<typeof createAcceptanceDesktop>;
