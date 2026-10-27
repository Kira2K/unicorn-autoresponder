import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createAgent } from '../bridge/agent.mjs';
import { createBridgeLocalFetch } from '../bridge/local-api.mjs';
import { loadSettings, fail } from './settings.mjs';
import { openRenderJournal } from './journal.mjs';
import { createDrainingFetch } from './requests.mjs';
import { startBridgeLoop } from './worker.mjs';
import { supervise, readDisplay } from './supervisor.mjs';
import { inspectOwner } from './readiness.mjs';

const report = value => console.log(JSON.stringify(value));
const children = new Set();
function child(command, args, env, captureOutput = false) {
  const proc = spawn(command, args, { env, detached: true, stdio: ['ignore', captureOutput ? 'pipe' : 'ignore', 'ignore'] });
  let exited = false;
  const done = new Promise(resolve => {
    proc.once('error', () => { exited = true; resolve(); });
    proc.once('exit', () => { exited = true; children.delete(proc.pid); resolve(); });
  });
  if (proc.pid) children.add(proc.pid);
  function kill(signal) { if (!exited) try { process.kill(-proc.pid, signal); } catch {} }
  return { done, output: proc.stdout, async stop() {
    if (exited) return;
    kill('SIGTERM');
    let timer;
    try { await Promise.race([done, new Promise(resolve => { timer = setTimeout(resolve, 1_000); })]); }
    finally { clearTimeout(timer); }
    if (!exited) kill('SIGKILL');
    await done;
  } };
}

let journal, network, hardTimer, externalStop = false, shutdown;
const signal = new AbortController();
const stopping = new Promise(resolve => { shutdown = resolve; });
function beginStop() {
  if (signal.signal.aborted) return;
  signal.abort(); network?.stop(); shutdown();
  hardTimer = setTimeout(() => {
    for (const pid of children) try { process.kill(-pid, 'SIGKILL'); } catch {}
    // Preserve an executing journal entry and its lock if storage cannot drain.
    process.exit(1);
  }, 27_000);
}
for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => { externalStop = true; beginStop(); });

try {
  const settings = await loadSettings();
  journal = await openRenderJournal(`${settings.dataDir}/bridge/journal.json`, settings.config, settings.machine);
  network = createDrainingFetch(settings.config.backendUrl);
  if (signal.signal.aborted) throw fail('bridge_render_stopping');
  let port = 58888, display;
  const env = { ...process.env, DISPLAY: ':99', OCTO_HEADLESS: '1', APPIMAGE_EXTRACT_AND_RUN: '1',
    QT_X11_NO_MITSHM: '1', OCTO_API_TOKEN: settings.token };
  const local = (input, init) => createBridgeLocalFetch(port, network.fetch)(input, init);
  const agent = createAgent({ config: settings.config, journal, fetchImpl: local });
  report({ state: 'starting', mode: settings.mode });
  await supervise({
    stopping, beginStop, report,
    startDisplay: () => { display = child('Xvfb', ['-displayfd', '1', '-screen', '0', '1280x720x24', '-nolisten', 'tcp'],
      process.env, true); return display; },
    async displayReady() {
      env.DISPLAY = await readDisplay(display, signal.signal);
    },
    startOcto: () => child('/home/octo/browser/OctoBrowser.AppImage', [], env),
    async ready() {
      const deadline = Date.now() + 1_200_000;
      while (!signal.signal.aborted && Date.now() < deadline) {
        try {
          const value = await readFile('/home/octo/.Octo Browser/local_port', 'utf8');
          const candidate = Number(value.trim());
          if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535)
            throw fail('bridge_invalid_local_port');
          port = candidate;
          return await inspectOwner(port, settings, network.fetch);
        } catch (e) {
          if (['bridge_wrong_owner', 'bridge_invalid_local_port', 'bridge_render_octo_version_requires_review',
            'bridge_render_version_unverified'].includes(e.code)) throw e;
        }
        await new Promise(resolve => {
          const timer = setTimeout(done, 1_000);
          function done() { clearTimeout(timer); signal.signal.removeEventListener('abort', done); resolve(); }
          signal.signal.addEventListener('abort', done, { once: true });
          if (signal.signal.aborted) done();
        });
      }
      throw fail(signal.signal.aborted ? 'bridge_render_stopping' : 'bridge_render_octo_start_timeout');
    },
    startBridge: () => startBridgeLoop(agent, { mode: settings.mode, pollMilliseconds: settings.config.pollMilliseconds, report }),
    async closeJournal() { await journal.close(); journal = undefined; },
  });
  report({ state: 'stopped' });
} catch (e) {
  if (!externalStop) {
    report({ error: /^bridge_[a-z0-9_]{1,100}$/.test(e.code ?? '') ? e.code : 'bridge_render_start_failed' });
    process.exitCode = 1;
  }
} finally {
  network?.dispose();
  if (journal) await journal.close();
  clearTimeout(hardTimer);
}
