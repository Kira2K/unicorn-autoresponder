import { resolve } from 'node:path';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NAMES, profileName, TestError } from './contract.mts';
import { createOctoApi } from './octo-api.mts';
import { acquireProcessLock, createFileStore, createValidatedFileStore } from './store.mts';
import { fixturesFromState, validateTimedState } from './timed-contract.mts';
import { createTimedWorkflow } from './timed-workflow.mts';
import { createActionLogListener } from './action-log.mts';

// An explicit manual experiment: no HTTP server, desktop API, browser start or stop.
// The process stays alive after the 45-second handoff to handle the user's close.
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--grant')) throw new TestError('usage_cloud_experiment_--grant_Alex_or_Bob');
  const name = args.length ? profileName(args[1]) : undefined;
  const token = process.env.OCTO_API_TOKEN ?? '';
  const fixtures = fixturesFromState(await createFileStore(resolve('storage/octo-access-test/state.json')).load());
  const statePath = resolve('storage/octo-access-test/cloud-state.json');
  const release = await acquireProcessLock(statePath);
  const runId = randomUUID(), directory = `logs/octo-access-test/cloud-manual-${runId}`;
  await mkdir(directory, { recursive: true });
  await writeFile('logs/octo-access-test/cloud-manual-latest.json', JSON.stringify({ runId, directory, pid: process.pid }));
  const record = async (event: string, data: unknown) => {
    const row = { at: new Date().toISOString(), event, data };
    await appendFile(`${directory}/events.jsonl`, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  };
  const counters = { cloudRequests: 0, blockedNonCloudRequests: 0 };
  const cloudFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://app.octobrowser.net' || !url.pathname.startsWith('/api/v2/automation/')) {
      counters.blockedNonCloudRequests++; throw new TestError('non_cloud_request_forbidden');
    }
    counters.cloudRequests++;
    const response = await fetch(input, init);
    await record('cloud_http', { method: init?.method ?? 'GET', path: url.pathname, status: response.status });
    return response;
  };
  const api = createOctoApi(token, cloudFetch, { cloudOnly: true });
  let events: ReturnType<typeof createActionLogListener> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, closing = false;
  try {
    const workflow = await createTimedWorkflow({ api, fixtures, cloudOnly: true, waitForManualStart: true, store: createValidatedFileStore(statePath, validateTimedState) });
    let lastStatus = '';
    let reporting: Promise<unknown> = Promise.resolve();
    const report = () => {
      const next = reporting.then(async () => {
        const status = workflow.status(), key = JSON.stringify(status);
        if (key === lastStatus) return;
        lastStatus = key;
        await record('workflow', { ...status, events: events?.status(), network: { ...counters } });
        for (const fixtureName of NAMES) {
          if (!status.grants[fixtureName]) continue;
          const p = await api.getProfile(fixtures.profiles[fixtureName]);
          await record('cloud_readback', { profile: fixtureName, title: p.title, folder: p.folder, status: p.status, has_user_password: p.has_user_password });
        }
      });
      reporting = next.catch(() => {}); return next;
    };
    events = createActionLogListener({ token, profileIds: Object.values(fixtures.profiles), loadCursor: workflow.cursor,
      onPage: async page => { await workflow.onPage(page); await report(); } });
    events.start();
    const connectedBy = Date.now() + 15000;
    while (!events.status().connected && Date.now() < connectedBy) await new Promise(done => setTimeout(done, 100));
    if (!events.status().connected) throw new TestError('action_log_connection_required');
    await workflow.setup();
    if (name) {
      const grant = await workflow.grant(name);
      // The intentionally fixed fixture password is supplied by the operator, not logged.
      await record('manual_open_now', { profile: name, uuid: grant.uuid, alias: grant.alias, expiresAt: grant.expiresAt, durationAfterLaunchMs: 45000 });
    }
    await report();
    const tick = async () => {
      try { await workflow.tick(); await report(); }
      catch (error) { await record('worker_error', { code: error instanceof TestError ? error.code : 'cloud_worker_error' }); }
      if (!closing) timer = setTimeout(() => { void tick(); }, 500);
    };
    void tick();
    const shutdown = () => {
      if (closing) return; closing = true; if (timer) clearTimeout(timer);
      void (async () => { await events!.stop(); await workflow.drain(); await reporting; await release(); })()
        .catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  } catch (error) { await events?.stop(); await release(); throw error; }
}

await main().catch(error => {
  console.error(error instanceof TestError ? error.code : 'cloud_experiment_failed'); process.exitCode = 1;
});
