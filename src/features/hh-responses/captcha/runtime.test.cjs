const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCaptchaRuntime } = require('./browser-runtime.js');

test('keeps the same operation pending, excludes captcha time, handles recurrence', async () => {
  let time = 10, shown = true, polls = 0, timedOut = false;
  const runtime = createCaptchaRuntime({
    visible: () => shown, now: () => time,
    sleep: async () => { time += 100; if (++polls === 3) shown = false; },
    onTimeout: () => { timedOut = true; }
  });
  await runtime.wait();
  assert.equal(runtime.now(), 10);
  shown = true; polls = 0;
  await runtime.wait();
  assert.equal(runtime.now(), 10);
  assert.equal(timedOut, false);
});

test('captcha timeout is bounded and reported once with overlapping waiters', async () => {
  let time = 10, failures = 0;
  const runtime = createCaptchaRuntime({visible: () => true, now: () => time,
    sleep: async () => { time += 100; }, timeoutMs: 250,
    onTimeout: () => { failures++; }});
  await Promise.all([runtime.wait(), runtime.wait()]);
  assert.equal(failures, 1);
  assert.equal(runtime.paused(), false);
});

test('STOP aborts waiting without submitting or changing a challenge', async () => {
  let stopped = false;
  const runtime = createCaptchaRuntime({visible: () => true, isStopped: () => stopped,
    sleep: async () => { stopped = true; }, onTimeout: () => assert.fail('not a timeout')});
  await runtime.wait();
  assert.equal(runtime.paused(), false);
});
