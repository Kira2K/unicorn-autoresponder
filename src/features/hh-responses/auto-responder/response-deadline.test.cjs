const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createResponseDeadline } = require('./response-deadline.ts');
test('navigation and parser log activity cannot hide lack of sent responses', () => {
  let time = 0;
  const deadline = createResponseDeadline(100, () => time);
  time = 90; assert.equal(deadline.observe(0), false);
  time = 101; assert.equal(deadline.observe(0), true);
});
test('only a growing response count resets the deadline; disabled timeout remains disabled', () => {
  let time = 0;
  const deadline = createResponseDeadline(100, () => time);
  time = 90; assert.equal(deadline.observe(1), false);
  time = 150; assert.equal(deadline.observe(0), false);
  time = 191; assert.equal(deadline.observe(1), true);
  const disabled = createResponseDeadline(0, () => time);
  time += 10000; assert.equal(disabled.observe(0), false);
});
