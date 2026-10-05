import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePhoneEn } from './platform-account-policy.ts'

test('normalizePhoneEn stores phone_en as a plus followed by contiguous digits', () => {
  const cases: Array<[unknown, string]> = [
    ['+1 (555)-010', '+1555010'],
    ['1555010', '+1555010'],
    ['call +1 555', '+1555'],
    ['++49 +30 12', '+493012'],
    ['', ''],
    ['letters only', ''],
    [null, '']
  ]

  for (const [input, expected] of cases) {
    assert.equal(normalizePhoneEn(input), expected, String(input))
  }
})
