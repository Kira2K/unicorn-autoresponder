import { resolve } from 'node:path';
import { TestError } from './contract.mts';
import { createOctoApi } from './octo-api.mts';
import { acquireProcessLock, createFileStore, createValidatedFileStore } from './store.mts';
import { fixturesFromState, validateTimedState } from './timed-contract.mts';
import { createTimedWorkflow } from './timed-workflow.mts';
import { createActionLogListener } from './action-log.mts';
import { createTestServer } from './http.mts';

export async function startTimedBackend({ token, port = 58890 }: { token: string; port?: number }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || [58888, 58889].includes(port)) throw new TestError('invalid_timed_port', 500);
  const fixtures = fixturesFromState(await createFileStore(resolve('storage/octo-access-test/state.json')).load());
  const statePath = resolve('storage/octo-access-test/timed-state.json');
  const api = createOctoApi(token, fetch, { passwordClear: 'cloud', debugPort: true });
  const release = await acquireProcessLock(statePath);
  try {
    const workflow = await createTimedWorkflow({ api, fixtures, store: createValidatedFileStore(statePath, validateTimedState) });
    const events = createActionLogListener({ token, profileIds: Object.values(fixtures.profiles), loadCursor: workflow.cursor, onPage: workflow.onPage });
    let workerError: string | undefined, closing = false, timer: ReturnType<typeof setTimeout> | undefined;
    const server = createTestServer({ ...workflow, status: () => ({ ...workflow.status(), events: events.status(), workerError }) });
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    const tick = async () => {
      try { await workflow.tick(); workerError = undefined; }
      catch (error) { workerError = error instanceof TestError ? error.code : 'timed_worker_failed'; }
      if (!closing) timer = setTimeout(() => { void tick(); }, 500);
    };
    events.start(); void tick();
    let closed: Promise<void> | undefined;
    return { port, close() {
      if (closed) return closed;
      closing = true; if (timer) clearTimeout(timer);
      closed = (async () => {
        await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
        await events.stop(); await workflow.drain(); await release();
      })();
      return closed;
    } };
  } catch (error) { await release(); throw error; }
}
