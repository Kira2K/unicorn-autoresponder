import test from 'node:test';
import assert from 'node:assert/strict';
import { startBridgeLoop } from './worker.mjs';
test('default check operation never polls/claims/authorizes or mutates a profile', async () => {
  let checks = 0, steps = 0, loop;
  const ready = new Promise(resolve => {
    loop = startBridgeLoop({ async check() { checks++; return { ownerVerified: true, backendReady: true }; },
      async step() { steps++; } }, { mode: 'check', pollMilliseconds: 1, report: resolve });
  });
  await ready; loop.stop(); await loop.done;
  assert.equal(checks, 1); assert.equal(steps, 0);
});
test('worker stop lets an in-progress step save and prevents another poll', async () => {
  let finish, started, steps = 0;
  const active = new Promise(resolve => { started = resolve; });
  const step = new Promise(resolve => { finish = resolve; });
  const loop = startBridgeLoop({ async step() { steps++; started(); return step; } }, { mode: 'worker', pollMilliseconds: 1 });
  await active; loop.stop(); finish({ state: 'succeeded' }); await loop.done;
  assert.equal(steps, 1);
});
