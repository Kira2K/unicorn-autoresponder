import { fail } from './settings.mjs';

// Xvfb chooses an available display; fixed :99 can leave a stale socket after SIGKILL.
export function readDisplay(child, signal, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let value = '', settled = false;
    const finish = (error, name) => {
      if (settled) return; settled = true;
      clearTimeout(timer); child.output.removeListener('data', data); signal.removeEventListener('abort', stop);
      if (error) reject(error); else resolve(name);
    };
    const stop = () => finish(fail('bridge_render_stopping'));
    const data = chunk => {
      value += String(chunk);
      if (value.length > 16 || /[^\d\r\n]/.test(value)) return finish(fail('bridge_render_display_not_ready'));
      if (value.includes('\n')) {
        if (!/^\d{1,4}\r?\n$/.test(value)) return finish(fail('bridge_render_display_not_ready'));
        finish(undefined, `:${Number(value.trim())}`);
      }
    };
    const timer = setTimeout(() => finish(fail('bridge_render_display_not_ready')), timeoutMs);
    child.output.on('data', data); signal.addEventListener('abort', stop, { once: true });
    child.done.then(() => finish(fail('bridge_render_display_exited')));
    if (signal.aborted) stop();
  });
}

// Children expose done, stop. The bridge remains in-process so its journal is
// closed only after its last operation has finished saving its outcome.
export async function supervise({ startDisplay, displayReady, startOcto, ready, startBridge, stopping,
  beginStop, closeJournal, report = () => {} }) {
  let display, octo, bridge, error;
  const ended = (child, code) => child.done.then(() => { throw fail(code); });
  try {
    display = startDisplay();
    const displayEvent = await Promise.race([displayReady().then(() => 'ready'), stopping.then(() => 'stopped'),
      ended(display, 'bridge_render_display_exited')]);
    if (displayEvent === 'stopped') return;
    octo = startOcto();
    const event = await Promise.race([
      ready().then(value => ({ ready: value })), stopping.then(() => ({ stopped: true })),
      ended(display, 'bridge_render_display_exited'), ended(octo, 'bridge_render_octo_exited'),
    ]);
    if (!event.stopped) {
      report({ state: 'octo_ready', ...event.ready });
      bridge = startBridge();
      await Promise.race([stopping, ended(bridge, 'bridge_render_loop_exited'),
        ended(display, 'bridge_render_display_exited'), ended(octo, 'bridge_render_octo_exited')]);
    }
  } catch (e) { error = e; }
  finally {
    beginStop();
    try {
      bridge?.stop();
      if (bridge) await bridge.done;
      await closeJournal();
    } finally {
      try { await octo?.stop(); } finally { await display?.stop(); }
    }
  }
  if (error) throw error;
}
