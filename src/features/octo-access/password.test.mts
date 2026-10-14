import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProfilePassword } from './password.mts';
test('five digit passwords preserve leading zeros and full numeric range', () => {
  assert.equal(generateProfilePassword(() => 3742), '03742');
  assert.equal(generateProfilePassword(() => 0), '00000');
  assert.equal(generateProfilePassword(() => 99999), '99999');
  assert.match(generateProfilePassword(), /^\d{5}$/);
  assert.throws(() => generateProfilePassword(() => 100000));
});
