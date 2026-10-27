export function startBridgeLoop(agent, { mode, pollMilliseconds, report = () => {} }) {
  let stopped = false, wake, last = '', lastAt = 0;
  const done = (async () => {
    do {
      let value;
      try { value = mode === 'worker' ? await agent.step() : { ...(await agent.check()), mode: 'check' }; }
      catch (e) { value = { error: /^bridge_[a-z0-9_]{1,100}$/.test(e.code ?? '') ? e.code : 'bridge_render_unavailable' }; }
      const line = JSON.stringify(value);
      if (line !== last || Date.now() - lastAt >= 60_000) { report(value); last = line; lastAt = Date.now(); }
      if (stopped) break;
      await new Promise(resolve => {
        const timer = setTimeout(resolve, mode === 'check' ? 60_000 : pollMilliseconds);
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = undefined;
    } while (!stopped);
  })();
  return { done, stop() { stopped = true; wake?.(); } };
}
