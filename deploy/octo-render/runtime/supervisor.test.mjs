import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { supervise, readDisplay } from './supervisor.mjs';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
test('display allocation accepts split output and does not reuse a fixed stale display number', async () => {
  const output = new EventEmitter(), done = deferred(), signal = new AbortController();
  const work = readDisplay({ output, done: done.promise }, signal.signal);
  output.emit('data', '1'); output.emit('data', '2\n'); assert.equal(await work, ':12');
  assert.equal(output.listenerCount('data'), 0);
});
test('cancelled or invalid display startup cannot launch owner Octo', async () => {
  const signal = new AbortController(), done = deferred(), output = new EventEmitter();
  let work = readDisplay({ output, done: done.promise }, signal.signal);
  signal.abort(); await assert.rejects(work, { code: 'bridge_render_stopping' });
  work = readDisplay({ output, done: done.promise }, new AbortController().signal);
  output.emit('data', 'not-a-display\n'); await assert.rejects(work, { code: 'bridge_render_display_not_ready' });
});
function fixture() {
  const calls = [], stop = deferred(), displayReady = deferred(), ready = deferred(), active = deferred();
  const make = name => { const done = deferred(); return { done: done.promise, end: done.resolve,
    async stop() { calls.push(name + '.stop'); done.resolve(); } }; };
  const display = make('display'), octo = make('octo'), bridge = make('bridge');
  return { calls, stop, displayReady, ready, active, display, octo, bridge,
    deps: { stopping: stop.promise, startDisplay() { calls.push('display.start'); return display; },
      displayReady: () => displayReady.promise,
      startOcto() { calls.push('octo.start'); return octo; }, ready: () => ready.promise,
      startBridge() { calls.push('bridge.start'); active.resolve(); return bridge; },
      beginStop() { calls.push('requests.stop'); }, async closeJournal() { calls.push('journal.close'); } } };
}
test('startup waits for the display; shutdown drains bridge and journal before stopping owner Octo', async () => {
  const f = fixture(), work = supervise(f.deps);
  assert.deepEqual(f.calls, ['display.start']);
  f.displayReady.resolve(); f.ready.resolve({ ownerVerified: true }); await f.active.promise;
  f.stop.resolve(); await work;
  assert.deepEqual(f.calls, ['display.start', 'octo.start', 'bridge.start', 'requests.stop', 'bridge.stop',
    'journal.close', 'octo.stop', 'display.stop']);
});
test('stop while starting the display does not start Octo or bridge', async () => {
  const f = fixture(), work = supervise(f.deps);
  f.stop.resolve(); await work;
  assert.deepEqual(f.calls, ['display.start', 'requests.stop', 'journal.close', 'display.stop']);
});
test('unexpected owner exit stops admission and all remaining processes', async () => {
  const f = fixture(), work = supervise(f.deps);
  f.displayReady.resolve(); f.ready.resolve({ ownerVerified: true }); await f.active.promise;
  f.octo.end(); await assert.rejects(work, { code: 'bridge_render_octo_exited' });
  assert.ok(f.calls.includes('bridge.stop')); assert.ok(f.calls.includes('journal.close'));
  assert.equal(f.calls.at(-1), 'display.stop');
});
test('journal close failure still stops both child processes', async () => {
  const f = fixture(), work = supervise({ ...f.deps, closeJournal: async () => { throw Error('disk lost'); } });
  f.displayReady.resolve(); f.ready.resolve({ ownerVerified: true }); await f.active.promise;
  f.stop.resolve(); await assert.rejects(work, /disk lost/);
  assert.deepEqual(f.calls.slice(-2), ['octo.stop', 'display.stop']);
});
