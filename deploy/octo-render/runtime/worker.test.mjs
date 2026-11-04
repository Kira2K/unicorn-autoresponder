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

test('worker observes bounded retry delay and can stop immediately during backoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let steps=0;
 const loop=startBridgeLoop({async step(){steps++;throw Object.assign(Error('retry'),{code:'bridge_backend_response_unknown',retryAfterMs:8000});}}, {mode:'worker',pollMilliseconds:2000});
 try{for(let i=0;i<8;i++)await Promise.resolve();assert.equal(steps,1);t.mock.timers.tick(7999);await Promise.resolve();assert.equal(steps,1);t.mock.timers.tick(1);for(let i=0;i<8;i++)await Promise.resolve();assert.equal(steps,2);}
 finally{loop.stop();await loop.done;}
});
test('worker stop lets an in-progress step save and prevents another poll', async () => {
  let finish, started, steps = 0;
  const active = new Promise(resolve => { started = resolve; });
  const step = new Promise(resolve => { finish = resolve; });
  const loop = startBridgeLoop({ async step() { steps++; started(); return step; } }, { mode: 'worker', pollMilliseconds: 1 });
  await active; loop.stop(); finish({ state: 'succeeded' }); await loop.done;
  assert.equal(steps, 1);
});
